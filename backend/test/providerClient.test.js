const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const axios = require('axios');

process.env.API_URL = 'https://provider.invalid';
process.env.API_KEY = 'provider-secret';

const providerClient = require('../services/providerClient');
const originalPost = axios.post;

afterEach(() => {
    axios.post = originalPost;
});

test('accepted provider response returns a durable provider identifier', async () => {
    axios.post = async () => ({ status: 200, data: { order: 12345, status: 'Pending' } });
    const result = await providerClient.submitOrder({
        providerServiceId: '77', target: 'https://example.com/post', quantity: 1000,
    });
    assert.equal(result.classification, 'ACCEPTED');
    assert.equal(result.providerOrderId, '12345');
});

test('provider calls use the selected provider connection rather than global credentials', async () => {
    let request;
    axios.post = async (...args) => {
        request = args;
        return { status: 200, data: { order: 'second-order' } };
    };
    await providerClient.submitOrder({
        providerServiceId: 'second-service', target: 'https://example.com/post', quantity: 250,
    }, {
        apiUrl: 'https://second-provider.invalid/v2',
        apiKey: 'second-secret',
        timeoutMs: 4321,
    });
    assert.equal(request[0], 'https://second-provider.invalid/v2');
    assert.equal(request[2].params.key, 'second-secret');
    assert.equal(request[2].params.service, 'second-service');
    assert.equal(request[2].timeout, 4321);
});

test('explicit provider error is a definitive rejection', async () => {
    axios.post = async () => ({ status: 200, data: { error: 'Invalid link' } });
    const result = await providerClient.submitOrder({
        providerServiceId: '77', target: 'https://example.com/post', quantity: 1000,
    });
    assert.equal(result.classification, 'DEFINITIVE_REJECTION');
    assert.equal(result.failureKind, 'PROVIDER_REJECTION');
});

test('malformed success response is ambiguous', async () => {
    axios.post = async () => ({ status: 200, data: { status: 'ok' } });
    const result = await providerClient.submitOrder({
        providerServiceId: '77', target: 'https://example.com/post', quantity: 1000,
    });
    assert.equal(result.classification, 'AMBIGUOUS');
    assert.equal(result.failureKind, 'MALFORMED_RESPONSE');
});

test('timeout and provider server errors are ambiguous', async () => {
    axios.post = async () => {
        const error = new Error('timeout');
        error.code = 'ETIMEDOUT';
        throw error;
    };
    const timeout = await providerClient.submitOrder({
        providerServiceId: '77', target: 'https://example.com/post', quantity: 1000,
    });
    assert.equal(timeout.classification, 'AMBIGUOUS');
    assert.equal(timeout.failureKind, 'TIMEOUT');

    axios.post = async () => {
        const error = new Error('unavailable');
        error.response = { status: 503, data: { error: 'Temporarily unavailable' } };
        throw error;
    };
    const unavailable = await providerClient.submitOrder({
        providerServiceId: '77', target: 'https://example.com/post', quantity: 1000,
    });
    assert.equal(unavailable.classification, 'AMBIGUOUS');
    assert.equal(unavailable.failureKind, 'HTTP_5XX');

    axios.post = async () => {
        const error = new Error('connection reset');
        error.code = 'ECONNRESET';
        throw error;
    };
    const transport = await providerClient.submitOrder({
        providerServiceId: '77', target: 'https://example.com/post', quantity: 1000,
    });
    assert.equal(transport.classification, 'AMBIGUOUS');
    assert.equal(transport.failureKind, 'TRANSPORT');
});

test('provider response snapshots redact secret-shaped fields', () => {
    const snapshot = providerClient.responseSnapshot({
        key: 'secret', nested: { apiKey: 'also-secret', result: 'safe' },
    });
    assert.equal(snapshot.key, '[redacted]');
    assert.equal(snapshot.nested.apiKey, '[redacted]');
    assert.equal(snapshot.nested.result, 'safe');
    assert.equal(providerClient.responseSnapshot(undefined), null);
});
