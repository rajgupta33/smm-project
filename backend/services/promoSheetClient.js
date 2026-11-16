const { randomUUID } = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const { getRuntimeConfig } = require('../config/runtimeConfig');
const PromoSheetSettings = require('../models/PromoSheetSettings');
const AuditLog = require('../models/AuditLog');

/**
 * Client for the Google Apps Script web app that backs the WhatsApp promo
 * sheets (the same `Code.gs` contract as the standalone WA Sender PWA:
 * actions ping / tabs / rows / mark).
 *
 * The script URL and secret live on the server only (configured either via
 * Admin Panel Settings in MongoDB or via PROMO_SHEET_SCRIPT_URL /
 * PROMO_SHEET_SECRET_KEY environment variables). Resellers call our API, never
 * the script, so neither the credentials nor the spreadsheet link ever reach a
 * reseller's browser.
 */

class PromoSheetError extends Error {
    constructor(message, code = 'PROMO_SHEET_ERROR', statusCode = 502) {
        super(message);
        this.name = 'PromoSheetError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function getEnvSheetConfig() {
    try {
        return getRuntimeConfig().reseller.promoSheet;
    } catch {
        const rawUrl = process.env.PROMO_SHEET_SCRIPT_URL?.trim() || null;
        const rawKey = process.env.PROMO_SHEET_SECRET_KEY?.trim() || null;
        const timeoutMs = Number(process.env.PROMO_SHEET_TIMEOUT_MS ?? 20000);
        return {
            appsScriptUrl: rawUrl,
            secretKey: rawKey,
            timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 20000,
        };
    }
}

function getSheetConfig(overrides = {}) {
    const config = overrides.config || getEnvSheetConfig();
    if (!config.appsScriptUrl || !config.secretKey) {
        throw new PromoSheetError(
            'Promo sheet integration is not configured. Configure the Apps Script URL and secret key in Admin Settings or set PROMO_SHEET_SCRIPT_URL and PROMO_SHEET_SECRET_KEY.',
            'PROMO_SHEET_NOT_CONFIGURED',
            503
        );
    }
    return config;
}

function isConfigured(overrides = {}) {
    try {
        getSheetConfig(overrides);
        return true;
    } catch {
        return false;
    }
}

async function readStoredSettings() {
    if (mongoose.connection?.readyState !== 1) return null;
    try {
        return await PromoSheetSettings.findOne({ key: 'global' }).select('+secretKey').lean();
    } catch {
        return null;
    }
}

async function resolveSheetConfig(overrides = {}) {
    if (overrides.config) {
        return getSheetConfig(overrides);
    }

    const envCfg = getEnvSheetConfig();
    const dbCfg = await readStoredSettings();
    const appsScriptUrl = (dbCfg?.appsScriptUrl || envCfg.appsScriptUrl || '').trim();
    const secretKey = (dbCfg?.secretKey || envCfg.secretKey || '').trim();
    const timeoutMs = dbCfg?.timeoutMs || envCfg.timeoutMs || 20000;

    if (!appsScriptUrl || !secretKey) {
        throw new PromoSheetError(
            'Promo sheet integration is not configured. Configure the Apps Script URL and secret key in Admin Settings or set PROMO_SHEET_SCRIPT_URL and PROMO_SHEET_SECRET_KEY.',
            'PROMO_SHEET_NOT_CONFIGURED',
            503
        );
    }

    const source = dbCfg?.appsScriptUrl && dbCfg?.secretKey
        ? 'db'
        : (dbCfg?.appsScriptUrl || dbCfg?.secretKey)
            ? 'mixed'
            : 'env';

    return { appsScriptUrl, secretKey, timeoutMs, source, updatedAt: dbCfg?.updatedAt || null };
}

async function isConfiguredAsync(overrides = {}) {
    try {
        await resolveSheetConfig(overrides);
        return true;
    } catch {
        return false;
    }
}

function validateScriptUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) {
        throw new PromoSheetError('Apps Script Web App URL is required', 'INVALID_SCRIPT_URL', 400);
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new PromoSheetError('Apps Script Web App URL must be a valid URL', 'INVALID_SCRIPT_URL', 400);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new PromoSheetError('Apps Script Web App URL must use https or http', 'INVALID_SCRIPT_URL', 400);
    }
    return parsed.toString();
}

async function getAdminSettingsSummary() {
    const envCfg = getEnvSheetConfig();
    const dbCfg = await readStoredSettings();
    const appsScriptUrl = (dbCfg?.appsScriptUrl || envCfg.appsScriptUrl || '').trim();
    const hasSecretKey = Boolean((dbCfg?.secretKey || envCfg.secretKey || '').trim());
    const configured = Boolean(appsScriptUrl && hasSecretKey);
    const source = dbCfg?.appsScriptUrl || dbCfg?.secretKey
        ? 'panel'
        : (envCfg.appsScriptUrl || envCfg.secretKey)
            ? 'env'
            : 'none';

    return {
        appsScriptUrl,
        hasSecretKey,
        configured,
        source,
        timeoutMs: dbCfg?.timeoutMs || envCfg.timeoutMs || 20000,
        updatedAt: dbCfg?.updatedAt || null,
    };
}

async function saveAdminSettings({ appsScriptUrl, secretKey, timeoutMs }, actor, overrides = {}) {
    const cleanUrl = validateScriptUrl(appsScriptUrl);
    const existing = overrides.existingSettings !== undefined
        ? overrides.existingSettings
        : await readStoredSettings();
    const envCfg = getEnvSheetConfig();
    const trimmedKey = typeof secretKey === 'string' ? secretKey.trim() : '';
    const effectiveKey = trimmedKey || existing?.secretKey || envCfg.secretKey || '';

    if (!effectiveKey) {
        throw new PromoSheetError('Secret key is required', 'INVALID_SECRET_KEY', 400);
    }

    const parsedTimeout = timeoutMs === undefined || timeoutMs === '' || timeoutMs === null
        ? (existing?.timeoutMs || envCfg.timeoutMs || 20000)
        : Number(timeoutMs);
    if (!Number.isSafeInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
        throw new PromoSheetError('timeoutMs must be an integer between 1000 and 120000', 'INVALID_TIMEOUT', 400);
    }

    const Model = overrides.SettingsModel || PromoSheetSettings;
    const saved = await Model.findOneAndUpdate(
        { key: 'global' },
        {
            $set: {
                appsScriptUrl: cleanUrl,
                secretKey: effectiveKey,
                timeoutMs: parsedTimeout,
                updatedBy: actor?._id || null,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
        const Audit = overrides.AuditLogModel || AuditLog;
        await Audit.create({
            action: 'PROMO_SHEET_SETTINGS_UPDATED',
            actorType: 'ADMIN',
            actorId: actor?._id || null,
            targetType: 'PromoSheetSettings',
            targetId: 'global',
            requestId: actor?.requestId || randomUUID(),
            before: existing ? { appsScriptUrl: existing.appsScriptUrl, timeoutMs: existing.timeoutMs } : null,
            after: { appsScriptUrl: cleanUrl, timeoutMs: parsedTimeout, secretUpdated: Boolean(trimmedKey) },
        });
    } catch (error) {
        console.error('Failed to audit promo sheet settings update:', error.message);
    }

    return {
        appsScriptUrl: saved.appsScriptUrl,
        hasSecretKey: true,
        configured: true,
        source: 'panel',
        timeoutMs: saved.timeoutMs,
        updatedAt: saved.updatedAt,
    };
}

async function testConnection({ appsScriptUrl, secretKey } = {}, overrides = {}) {
    const existing = overrides.existingSettings !== undefined
        ? overrides.existingSettings
        : await readStoredSettings();
    const envCfg = getEnvSheetConfig();

    const cleanUrl = appsScriptUrl !== undefined && String(appsScriptUrl).trim() !== ''
        ? validateScriptUrl(appsScriptUrl)
        : (existing?.appsScriptUrl || envCfg.appsScriptUrl || '');
    const effectiveKey = typeof secretKey === 'string' && secretKey.trim() !== ''
        ? secretKey.trim()
        : (existing?.secretKey || envCfg.secretKey || '');

    if (!cleanUrl || !effectiveKey) {
        throw new PromoSheetError(
            'Enter both the Apps Script Web App URL and Secret key to test the connection.',
            'PROMO_SHEET_NOT_CONFIGURED',
            400
        );
    }

    const timeoutMs = existing?.timeoutMs || envCfg.timeoutMs || 20000;
    await ping({
        ...overrides,
        config: { appsScriptUrl: cleanUrl, secretKey: effectiveKey, timeoutMs },
    });
    return { ok: true };
}

/**
 * Apps Script answers 200 with `{ ok:false, error }` for its own failures, so
 * a non-throwing HTTP call still has to be inspected.
 */
async function callScript(action, params = {}, overrides = {}) {
    const config = await resolveSheetConfig(overrides);
    const client = overrides.httpClient || axios;
    let response;
    try {
        response = await client.get(config.appsScriptUrl, {
            params: { action, key: config.secretKey, ...params },
            timeout: config.timeoutMs,
            // Apps Script answers the /exec URL with a 302 to a googleusercontent
            // host that serves the JSON body, so redirects must be followed.
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 400,
        });
    } catch (error) {
        const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
        throw new PromoSheetError(
            `Google Sheet request failed: ${error.message}`,
            timedOut ? 'PROMO_SHEET_TIMEOUT' : 'PROMO_SHEET_UNREACHABLE',
            504
        );
    }

    const body = response.data;
    if (!body || typeof body !== 'object') {
        throw new PromoSheetError('Google Sheet returned an unreadable response', 'PROMO_SHEET_MALFORMED');
    }
    if (body.ok === false) {
        const message = String(body.error || 'Unknown Apps Script error');
        const invalidKey = /invalid key|SECRET_KEY/i.test(message);
        throw new PromoSheetError(
            `Google Sheet rejected the request: ${message}`,
            invalidKey ? 'PROMO_SHEET_UNAUTHORIZED' : 'PROMO_SHEET_REJECTED',
            invalidKey ? 503 : 502
        );
    }
    return body;
}

function ping(overrides = {}) {
    return callScript('ping', {}, overrides);
}

/** Lists the tabs of a spreadsheet so an admin can pick one when assigning it. */
async function listTabs(spreadsheetId, overrides = {}) {
    const body = await callScript('tabs', { id: spreadsheetId }, overrides);
    return { title: body.title || '', tabs: Array.isArray(body.tabs) ? body.tabs : [] };
}

/**
 * Reads the mapped columns. The script returns one entry per sheet row from
 * row 1, so index i holds sheet row i + 1.
 */
async function fetchRows({ spreadsheetId, tab, columns }, overrides = {}) {
    const cols = [columns.name, columns.number, columns.link, columns.status].join(',');
    const body = await callScript('rows', { id: spreadsheetId, tab, cols }, overrides);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return rows.map((row, index) => ({
        rowNumber: index + 1,
        name: String(row?.[0] ?? '').trim(),
        number: String(row?.[1] ?? '').trim(),
        link: String(row?.[2] ?? '').trim(),
        status: String(row?.[3] ?? '').trim(),
    }));
}

/**
 * Stamps the status cell. Without `force` the script leaves an already-filled
 * cell alone and reports `already:true`, so a retry can never overwrite an
 * earlier reseller's mark.
 */
function markRow({ spreadsheetId, tab, statusColumn, rowNumber, value, force = false }, overrides = {}) {
    return callScript('mark', {
        id: spreadsheetId,
        tab,
        col: statusColumn,
        row: rowNumber,
        value,
        ...(force ? { force: '1' } : {}),
    }, overrides);
}

/** Pulls the spreadsheet id out of any Google Sheets URL, or accepts a bare id. */
function extractSpreadsheetId(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    return /^[a-zA-Z0-9-_]{20,}$/.test(value) ? value : null;
}

module.exports = {
    PromoSheetError,
    extractSpreadsheetId,
    fetchRows,
    getAdminSettingsSummary,
    isConfigured,
    isConfiguredAsync,
    listTabs,
    markRow,
    ping,
    resolveSheetConfig,
    saveAdminSettings,
    testConnection,
};
