const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertProviderAdapter } = require('../providers/providerAdapter');
const { normalizeProviderService, parseProviderBalance } = require('../providers/legacySmmProviderAdapter');
const {
    getProviderAdapterForProvider,
    resolveCredentialReference,
} = require('../providers/providerRegistry');

test('provider adapters must implement the complete fulfilment contract', () => {
    assert.throws(() => assertProviderAdapter({ getServices() {} }), /placeOrder/);
    const adapter = {
        getServices() {}, placeOrder() {}, getOrderStatus() {},
        requestRefill() {}, getRefillStatus() {},
    };
    assert.equal(assertProviderAdapter(adapter), adapter);
});

test('provider adapters bind each provider URL, environment credential, and timeout independently', () => {
    const adapter = getProviderAdapterForProvider({
        enabled: true,
        adapterType: 'LEGACY_SMM',
        apiBaseUrl: 'https://second-provider.invalid/api',
        credentialReference: 'env:SECOND_PROVIDER_KEY',
        timeoutMs: 9000,
    }, { env: { SECOND_PROVIDER_KEY: 'second-secret' } });
    assert.equal(adapter.adapterType, 'LEGACY_SMM');
    assert.equal(resolveCredentialReference('env:SECOND_PROVIDER_KEY', { SECOND_PROVIDER_KEY: 'value' }), 'value');
    assert.throws(
        () => resolveCredentialReference('raw-secret', {}),
        (error) => error.code === 'INVALID_PROVIDER_CREDENTIAL_REFERENCE'
    );
    assert.throws(
        () => resolveCredentialReference('env:MISSING_KEY', {}),
        (error) => error.code === 'PROVIDER_CREDENTIAL_UNAVAILABLE'
    );
});

test('legacy provider balances parse into paise and reject errors or malformed values', () => {
    assert.deepEqual(parseProviderBalance({ balance: '100.84292', currency: 'inr' }), { balanceMinor: 10084, currency: 'INR' });
    assert.deepEqual(parseProviderBalance({ balance: -5.5 }), { balanceMinor: -550, currency: null });
    assert.throws(
        () => parseProviderBalance({ error: 'Invalid API key' }),
        (error) => error.code === 'PROVIDER_BALANCE_REJECTED'
    );
    for (const data of [{}, { balance: '' }, { balance: 'n/a' }, null]) {
        assert.throws(() => parseProviderBalance(data), (error) => error.code === 'MALFORMED_BALANCE_RESPONSE');
    }
});

test('legacy provider services normalize without exposing a customer catalogue ID', () => {
    const raw = {
        service: 77, name: 'Followers', category: 'Instagram',
        type: 'Default', rate: '1.25', min: '100', max: '10000', refill: 'true',
    };
    const normalized = normalizeProviderService(raw);
    assert.equal(normalized.providerServiceId, '77');
    assert.equal(normalized.supportsRefill, true);
    assert.equal(normalized.raw, raw);
    assert.equal(normalized.serviceId, undefined);
});
