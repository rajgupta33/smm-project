const axios = require('axios');
const { randomUUID } = require('crypto');
const { getRuntimeConfig } = require('../config/runtimeConfig');

class CashfreeError extends Error {
    constructor(message, {
        code = 'CASHFREE_REQUEST_FAILED', statusCode = 502,
        retryable = false, ambiguous = false, gatewayStatus = null,
    } = {}) {
        super(message);
        this.name = 'CashfreeError';
        this.code = code;
        this.statusCode = statusCode;
        this.retryable = retryable;
        this.ambiguous = ambiguous;
        this.gatewayStatus = gatewayStatus;
    }
}

function baseUrl(environment) {
    return environment === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
}

function safeSnapshot(data) {
    if (!data || typeof data !== 'object') return null;
    return {
        order_id: data.order_id ? String(data.order_id) : null,
        cf_order_id: data.cf_order_id ? String(data.cf_order_id) : null,
        order_status: data.order_status || null,
        order_amount: data.order_amount ?? null,
        order_currency: data.order_currency || null,
        code: data.code || null,
        type: data.type || null,
    };
}

function classifyError(error, operation) {
    const status = error.response?.status;
    const code = error.response?.data?.code || `CASHFREE_${operation}_FAILED`;
    if (!status || status >= 500 || status === 429) {
        return new CashfreeError('Cashfree request outcome requires reconciliation', {
            code, retryable: true, ambiguous: operation === 'CREATE_ORDER', gatewayStatus: status || null,
        });
    }
    return new CashfreeError('Cashfree rejected the request', {
        code, statusCode: status === 401 ? 502 : 422, retryable: false, gatewayStatus: status,
    });
}

function createCashfreeClient(overrides = {}) {
    const config = overrides.config || getRuntimeConfig().cashfree;
    const http = overrides.http || axios;
    const headers = (extra = {}) => ({
        'content-type': 'application/json',
        'x-api-version': config.apiVersion,
        'x-client-id': config.appId,
        'x-client-secret': config.secretKey,
        'x-request-id': randomUUID(),
        ...extra,
    });

    return {
        async createOrder(input) {
            try {
                const response = await http.post(`${baseUrl(config.environment)}/orders`, input.body, {
                    headers: headers({ 'x-idempotency-key': input.idempotencyKey }), timeout: 15000,
                });
                return response.data;
            } catch (error) {
                throw classifyError(error, 'CREATE_ORDER');
            }
        },
        async getOrder(merchantOrderId) {
            try {
                const response = await http.get(
                    `${baseUrl(config.environment)}/orders/${encodeURIComponent(merchantOrderId)}`,
                    { headers: headers(), timeout: 15000 }
                );
                return response.data;
            } catch (error) {
                throw classifyError(error, 'GET_ORDER');
            }
        },
        async getPayments(merchantOrderId) {
            try {
                const response = await http.get(
                    `${baseUrl(config.environment)}/orders/${encodeURIComponent(merchantOrderId)}/payments`,
                    { headers: headers(), timeout: 15000 }
                );
                if (!Array.isArray(response.data)) throw new Error('Cashfree payments response is invalid');
                return response.data;
            } catch (error) {
                if (error instanceof CashfreeError) throw error;
                throw classifyError(error, 'GET_PAYMENTS');
            }
        },
        async getRefunds(merchantOrderId) {
            try {
                const response = await http.get(
                    `${baseUrl(config.environment)}/orders/${encodeURIComponent(merchantOrderId)}/refunds`,
                    { headers: headers(), timeout: 15000 }
                );
                if (!Array.isArray(response.data)) throw new Error('Cashfree refunds response is invalid');
                return response.data;
            } catch (error) {
                throw classifyError(error, 'GET_REFUNDS');
            }
        },
        async getDisputes(merchantOrderId) {
            try {
                const response = await http.get(
                    `${baseUrl(config.environment)}/orders/${encodeURIComponent(merchantOrderId)}/disputes`,
                    { headers: headers(), timeout: 15000 }
                );
                if (!Array.isArray(response.data)) throw new Error('Cashfree disputes response is invalid');
                return response.data;
            } catch (error) {
                throw classifyError(error, 'GET_DISPUTES');
            }
        },
        config,
    };
}

module.exports = { CashfreeError, baseUrl, createCashfreeClient, safeSnapshot };
