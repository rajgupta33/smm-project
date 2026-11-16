const assert = require('node:assert/strict');
const test = require('node:test');

const { commissionFor } = require('../services/commissionService');
const { createCampaign, normalizePhone } = require('../services/promoCampaignService');
const { buildSendLink } = require('../services/promoLeadService');
const promoSheetClient = require('../services/promoSheetClient');
const CommissionLedger = require('../models/CommissionLedger');
const PromoCampaign = require('../models/PromoCampaign');
const PromoLead = require('../models/PromoLead');
const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');

// --- commission arithmetic ---------------------------------------------------

test('commission is a share of profit and never exceeds it', () => {
    assert.equal(commissionFor(10000, 2500), 2500);
    assert.equal(commissionFor(10000, 10000), 10000);
    assert.equal(commissionFor(10000, 0), 0);
    // Even a nonsensical rate cannot pay out more than the order earned.
    assert.ok(commissionFor(10000, 10000) <= 10000);
});

test('commission always rounds down so payouts cannot exceed the spread', () => {
    // 3 paise of profit at 25% is 0.75 paise, which must not become 1.
    assert.equal(commissionFor(3, 2500), 0);
    assert.equal(commissionFor(7, 2500), 1);
    assert.equal(commissionFor(1999, 2500), 499);
});

test('commission is zero for a loss-making or invalid spread', () => {
    assert.equal(commissionFor(0, 2500), 0);
    assert.equal(commissionFor(-500, 2500), 0);
    assert.equal(commissionFor(1000.5, 2500), 0);
    assert.equal(commissionFor(1000, -100), 0);
});

// --- phone normalisation -----------------------------------------------------

test('bare local numbers gain the campaign country code', () => {
    assert.equal(normalizePhone('9876543210', '91'), '919876543210');
    assert.equal(normalizePhone('98765 43210', '91'), '919876543210');
    assert.equal(normalizePhone('+91 98765 43210', '91'), '919876543210');
    assert.equal(normalizePhone('971544468835', '91'), '971544468835');
});

test('unusable phone cells normalise to an empty string', () => {
    assert.equal(normalizePhone('', '91'), '');
    assert.equal(normalizePhone('not a number', '91'), '');
    assert.equal(normalizePhone(null, '91'), '');
});

// --- send link ---------------------------------------------------------------

test('a WhatsApp link from the sheet is used as-is', () => {
    const link = 'https://api.whatsapp.com/send?phone=919876543210&text=hello';
    const sendLink = buildSendLink(
        { messageLink: link, normalizedPhone: '919876543210' },
        { messageTemplate: '' }
    );
    assert.equal(sendLink, link);
});

test('a non-WhatsApp link in the sheet cannot redirect a reseller off-platform', () => {
    const sendLink = buildSendLink(
        { messageLink: 'https://evil.example/phish', normalizedPhone: '919876543210', displayName: 'Asha' },
        { messageTemplate: 'Hi {{name}}' }
    );
    assert.equal(sendLink, 'https://wa.me/919876543210?text=Hi%20Asha');
});

test('the campaign template fills in the row name and number', () => {
    const sendLink = buildSendLink(
        { messageLink: '', normalizedPhone: '919876543210', displayName: 'Asha' },
        { messageTemplate: 'Hi {{ name }}, reply on {{number}}' }
    );
    assert.equal(
        sendLink,
        'https://wa.me/919876543210?text=Hi%20Asha%2C%20reply%20on%20919876543210'
    );
});

// --- sheet client ------------------------------------------------------------

test('a spreadsheet id is recovered from a full sheet URL or a bare id', () => {
    assert.equal(
        promoSheetClient.extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEf_123456789012345/edit#gid=0'),
        '1AbC-dEf_123456789012345'
    );
    assert.equal(promoSheetClient.extractSpreadsheetId('1AbC-dEf_123456789012345'), '1AbC-dEf_123456789012345');
    assert.equal(promoSheetClient.extractSpreadsheetId('https://example.com/not-a-sheet'), null);
    assert.equal(promoSheetClient.extractSpreadsheetId(''), null);
});

test('marketing calls fail closed when the Apps Script is not configured', async () => {
    const config = { appsScriptUrl: null, secretKey: null, timeoutMs: 1000 };
    assert.equal(promoSheetClient.isConfigured({ config }), false);
    await assert.rejects(
        () => promoSheetClient.ping({ config }),
        (error) => error.code === 'PROMO_SHEET_NOT_CONFIGURED' && error.statusCode === 503
    );
});

test('an Apps Script 200 carrying ok:false is treated as a failure', async () => {
    const config = { appsScriptUrl: 'https://script.example/exec', secretKey: 'k', timeoutMs: 1000 };
    const httpClient = { get: async () => ({ data: { ok: false, error: 'Invalid key' } }) };
    await assert.rejects(
        () => promoSheetClient.ping({ config, httpClient }),
        (error) => error.code === 'PROMO_SHEET_UNAUTHORIZED'
    );
});

test('sheet rows map onto their real sheet row numbers', async () => {
    const config = { appsScriptUrl: 'https://script.example/exec', secretKey: 'k', timeoutMs: 1000 };
    const httpClient = {
        get: async () => ({
            data: {
                ok: true,
                rows: [
                    ['Name', 'Number', 'Link', 'Status'],
                    ['Asha', '9876543210', 'https://wa.me/919876543210', ''],
                ],
            },
        }),
    };
    const rows = await promoSheetClient.fetchRows(
        { spreadsheetId: 'sheet', tab: 'Leads', columns: { name: 'A', number: 'B', link: 'C', status: 'D' } },
        { config, httpClient }
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rowNumber, 1);
    assert.equal(rows[1].rowNumber, 2);
    assert.equal(rows[1].name, 'Asha');
});

test('the status cell is stamped without force so an existing mark survives', async () => {
    const config = { appsScriptUrl: 'https://script.example/exec', secretKey: 'k', timeoutMs: 1000 };
    let sentParams;
    const httpClient = {
        get: async (url, options) => {
            sentParams = options.params;
            return { data: { ok: true, already: false, value: 'Sent' } };
        },
    };
    await promoSheetClient.markRow(
        { spreadsheetId: 'sheet', tab: 'Leads', statusColumn: 'D', rowNumber: 7, value: 'Sent by A' },
        { config, httpClient }
    );
    assert.equal(sentParams.action, 'mark');
    assert.equal(sentParams.row, 7);
    assert.equal(sentParams.col, 'D');
    assert.equal(sentParams.force, undefined);
});

// --- schema guarantees -------------------------------------------------------

test('a reseller commission rate cannot exceed 100% of profit', () => {
    const tooHigh = new ResellerProfile({
        userId: '507f1f77bcf86cd799439011',
        referralCode: 'ABCD',
        commissionBps: 10001,
    });
    const error = tooHigh.validateSync();
    assert.ok(error?.errors?.commissionBps, 'commissionBps above 10000 must be rejected');

    const valid = new ResellerProfile({
        userId: '507f1f77bcf86cd799439011',
        referralCode: 'ABCD',
        commissionBps: 10000,
    });
    assert.equal(valid.validateSync(), undefined);
});

test('a reseller defaults to 25% of profit held for 7 days with marketing on', () => {
    const profile = new ResellerProfile({
        userId: '507f1f77bcf86cd799439011',
        referralCode: 'GETFAME1',
    });
    assert.equal(profile.commissionBps, 2500);
    assert.equal(profile.holdDays, 7);
    assert.equal(profile.marketingEnabled, true);
    assert.equal(profile.status, 'ACTIVE');
    // Codes are stored uppercase so lookups are unambiguous.
    const lowercase = new ResellerProfile({ userId: '507f1f77bcf86cd799439011', referralCode: 'getfame1' });
    assert.equal(lowercase.referralCode, 'GETFAME1');
});

test('one commission row per reseller per order is enforced by a unique index', () => {
    const unique = CommissionLedger.schema.indexes().find(
        ([fields, options]) => options?.unique
            && fields.resellerProfileId === 1
            && fields.orderId === 1
    );
    assert.ok(unique, 'CommissionLedger must carry a unique (resellerProfileId, orderId) index');
});

test('one lead row per campaign sheet row is enforced by a unique index', () => {
    const unique = PromoLead.schema.indexes().find(
        ([fields, options]) => options?.unique && fields.campaignId === 1 && fields.rowNumber === 1
    );
    assert.ok(unique, 'PromoLead must carry a unique (campaignId, rowNumber) index');
});

test('a commission entry only moves between the five defined states', () => {
    const states = CommissionLedger.schema.path('status').enumValues;
    assert.deepEqual(states, ['PENDING', 'HELD', 'AVAILABLE', 'PAID', 'REVERSED']);
});

test('the campaign spreadsheet is never selected by default', () => {
    // A reseller-facing query that forgets to project fields must not receive
    // the sheet id or link.
    assert.equal(PromoCampaign.schema.path('spreadsheetId').options.select, false);
    assert.equal(PromoCampaign.schema.path('sheetUrl').options.select, false);
});

test('a campaign refuses to reuse the number column as the status column', async () => {
    // Stamping "sent" into the phone column would destroy the lead list.
    await assert.rejects(
        () => createCampaign({
            name: 'Test',
            sheetUrl: 'https://docs.google.com/spreadsheets/d/1AbC-dEf_123456789012345/edit',
            tab: 'Leads',
            columns: { name: 'A', number: 'B', link: 'C', status: 'B' },
        }, null),
        (error) => error.code === 'INVALID_COLUMN'
    );
});

test('referral attribution is stored on the customer and indexed for lookup', () => {
    const referredBy = User.schema.path('referredBy');
    assert.ok(referredBy, 'User must record which reseller referred it');
    assert.equal(referredBy.options.ref, 'ResellerProfile');
    assert.equal(referredBy.options.default, null);
    const indexed = User.schema.indexes().some(([fields]) => fields.referredBy === 1);
    assert.ok(indexed, 'referredBy must be indexed for per-reseller customer lookups');
});

test('adminController.createUser supports creating a reseller profile directly from the role dropdown', async () => {
    const mongoose = require('mongoose');
    const bcrypt = require('bcrypt');
    const AuditLog = require('../models/AuditLog');
    const adminController = require('../controllers/adminController');

    const originalFindOne = User.findOne;
    const originalUserCreate = User.create;
    const originalExists = ResellerProfile.exists;
    const originalProfileCreate = ResellerProfile.create;
    const originalStartSession = mongoose.startSession;
    const originalHash = bcrypt.hash;
    const originalAuditCreate = AuditLog.create;

    let createdUserDoc;
    let createdProfileDoc;

    User.findOne = async () => null;
    User.create = async (docs) => {
        createdUserDoc = { _id: '507f1f77bcf86cd799439011', ...docs[0] };
        return [createdUserDoc];
    };
    ResellerProfile.exists = async () => null;
    ResellerProfile.create = async (docs) => {
        createdProfileDoc = { _id: '507f1f77bcf86cd799439022', ...docs[0] };
        return [createdProfileDoc];
    };
    mongoose.startSession = async () => { throw new Error('standalone'); };
    bcrypt.hash = async () => 'hashed-password';
    AuditLog.create = async () => ({});

    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };

    try {
        await adminController.createUser({
            payload: {
                userId: 'ResellerOne',
                password: 'secret123',
                role: 'reseller',
                services: ['SRV1', 'SRV2'],
                commissionBps: 3000,
                referralCode: 'PARTNER30',
            },
            currentUser: { _id: '507f1f77bcf86cd799439099' },
            get: () => null,
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.userId, 'resellerone');
        assert.equal(res.body.role, 'reseller');
        assert.equal(res.body.referralCode, 'PARTNER30');
        assert.equal(res.body.commissionBps, 3000);
        assert.equal(createdUserDoc.role, 'user');
        assert.deepEqual(createdUserDoc.services, ['SRV1', 'SRV2']);
        assert.equal(createdProfileDoc.referralCode, 'PARTNER30');
    } finally {
        User.findOne = originalFindOne;
        User.create = originalUserCreate;
        ResellerProfile.exists = originalExists;
        ResellerProfile.create = originalProfileCreate;
        mongoose.startSession = originalStartSession;
        bcrypt.hash = originalHash;
        AuditLog.create = originalAuditCreate;
    }
});

// --- Apps Script panel settings ----------------------------------------------

test('saveAdminSettings stores URL and secret key without exposing secretKey in the summary', async () => {
    const PromoSheetSettings = require('../models/PromoSheetSettings');
    assert.equal(PromoSheetSettings.schema.path('secretKey').options.select, false);

    let persisted;
    let audited;
    const SettingsModel = {
        findOneAndUpdate: async (_filter, update) => {
            persisted = { ...update.$set, updatedAt: new Date('2026-11-16T00:00:00Z') };
            return persisted;
        },
    };
    const AuditLogModel = {
        create: async (entry) => {
            audited = entry;
            return entry;
        },
    };

    const summary = await promoSheetClient.saveAdminSettings(
        { appsScriptUrl: 'https://script.google.com/macros/s/abc123/exec', secretKey: 'top-secret' },
        { _id: '507f1f77bcf86cd799439099', requestId: 'req-1' },
        { existingSettings: null, SettingsModel, AuditLogModel }
    );

    assert.equal(summary.appsScriptUrl, 'https://script.google.com/macros/s/abc123/exec');
    assert.equal(summary.hasSecretKey, true);
    assert.equal(summary.configured, true);
    assert.equal(summary.source, 'panel');
    assert.equal(summary.secretKey, undefined);
    assert.equal(persisted.secretKey, 'top-secret');
    assert.equal(audited.action, 'PROMO_SHEET_SETTINGS_UPDATED');
    assert.equal(audited.after.secretUpdated, true);
});

test('saveAdminSettings preserves existing secretKey when left blank on URL update', async () => {
    let persisted;
    const summary = await promoSheetClient.saveAdminSettings(
        { appsScriptUrl: 'https://script.google.com/macros/s/newurl/exec', secretKey: '' },
        { _id: '507f1f77bcf86cd799439099' },
        {
            existingSettings: {
                appsScriptUrl: 'https://script.google.com/macros/s/oldurl/exec',
                secretKey: 'kept-secret',
                timeoutMs: 20000,
            },
            SettingsModel: {
                findOneAndUpdate: async (_f, update) => {
                    persisted = update.$set;
                    return { ...persisted, updatedAt: new Date() };
                },
            },
            AuditLogModel: { create: async () => ({}) },
        }
    );

    assert.equal(persisted.secretKey, 'kept-secret');
    assert.equal(summary.hasSecretKey, true);
});

test('testConnection pings the Apps Script using form values or saved credentials', async () => {
    let calledUrl;
    let calledParams;
    const httpClient = {
        get: async (url, options) => {
            calledUrl = url;
            calledParams = options.params;
            return { data: { ok: true } };
        },
    };

    const result = await promoSheetClient.testConnection(
        { appsScriptUrl: 'https://script.google.com/macros/s/test/exec', secretKey: '' },
        {
            existingSettings: {
                appsScriptUrl: 'https://script.google.com/macros/s/saved/exec',
                secretKey: 'saved-key',
                timeoutMs: 15000,
            },
            httpClient,
        }
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(calledUrl, 'https://script.google.com/macros/s/test/exec');
    assert.equal(calledParams.action, 'ping');
    assert.equal(calledParams.key, 'saved-key');
});

test('updateCampaign rejects an endRow before the existing startRow', async () => {
    const { updateCampaign } = require('../services/promoCampaignService');
    const originalFindById = PromoCampaign.findById;
    PromoCampaign.findById = async () => ({ _id: '507f1f77bcf86cd799439033', startRow: 10, endRow: null });
    try {
        await assert.rejects(
            () => updateCampaign('507f1f77bcf86cd799439033', { endRow: 5 }, null),
            (error) => error.code === 'INVALID_CAMPAIGN_FIELD'
        );
    } finally {
        PromoCampaign.findById = originalFindById;
    }
});
