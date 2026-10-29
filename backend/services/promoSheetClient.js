const axios = require('axios');
const { getRuntimeConfig } = require('../config/runtimeConfig');

/**
 * Client for the Google Apps Script web app that backs the WhatsApp promo
 * sheets (the same `Code.gs` contract as the standalone WA Sender PWA:
 * actions ping / tabs / rows / mark).
 *
 * The script URL and secret live in backend configuration only. Resellers call
 * our API, never the script, so neither the credentials nor the spreadsheet
 * link ever reach a browser.
 */

class PromoSheetError extends Error {
    constructor(message, code = 'PROMO_SHEET_ERROR', statusCode = 502) {
        super(message);
        this.name = 'PromoSheetError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function getSheetConfig(overrides = {}) {
    const config = overrides.config || getRuntimeConfig().reseller.promoSheet;
    if (!config.appsScriptUrl || !config.secretKey) {
        throw new PromoSheetError(
            'Promo sheet integration is not configured. Set PROMO_SHEET_SCRIPT_URL and PROMO_SHEET_SECRET_KEY.',
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

/**
 * Apps Script answers 200 with `{ ok:false, error }` for its own failures, so
 * a non-throwing HTTP call still has to be inspected.
 */
async function callScript(action, params = {}, overrides = {}) {
    const config = getSheetConfig(overrides);
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
    isConfigured,
    listTabs,
    markRow,
    ping,
};
