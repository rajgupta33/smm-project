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
