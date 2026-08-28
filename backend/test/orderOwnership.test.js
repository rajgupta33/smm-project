const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');

process.env.API_URL = 'https://provider.invalid';
process.env.API_KEY = 'test-provider-key';

const axios = require('axios');
const Order = require('../models/Order');
const User = require('../models/User');
const userController = require('../controllers/userController');
const refillController = require('../controllers/refillController');
const RefillRequest = require('../models/RefillRequest');
const OrderEvent = require('../models/OrderEvent');

let originalAxiosGet;
let originalAxiosPost;
let originalOrderFindOne;
let originalUserFindOne;
let originalRefillFindOne;
let originalOrderEventFind;
let providerCallCount;

function createResponse() {
    return {
        body: undefined,
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

beforeEach(() => {
    originalAxiosGet = axios.get;
    originalAxiosPost = axios.post;
    originalOrderFindOne = Order.findOne;
    originalUserFindOne = User.findOne;
    originalRefillFindOne = RefillRequest.findOne;
    originalOrderEventFind = OrderEvent.find;
    providerCallCount = 0;

    User.findOne = async () => ({ _id: '507f1f77bcf86cd799439011' });
    Order.findOne = async () => null;
    RefillRequest.findOne = async () => null;
    axios.get = async () => {
        providerCallCount += 1;
        return { data: {} };
    };
    axios.post = async () => {
        providerCallCount += 1;
        return { data: {} };
    };
});

afterEach(() => {
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    Order.findOne = originalOrderFindOne;
    User.findOne = originalUserFindOne;
    RefillRequest.findOne = originalRefillFindOne;
    OrderEvent.find = originalOrderEventFind;
});

test('order status checks ownership before calling the provider', async () => {
    const response = createResponse();
    await userController.getOrderStatus(
        { body: { order: 'someone-elses-order' }, user: { id: 'normal-user' } },
        response
    );
    assert.equal(response.statusCode, 404);
    assert.equal(providerCallCount, 0);
});

test('refill status checks ownership before calling the provider', async () => {
    const response = createResponse();
    await refillController.legacyStatus(
        {
            body: { refillRequestId: 'someone-elses-refill' },
            currentUser: { _id: '507f1f77bcf86cd799439011' },
        },
        response
    );
    assert.equal(response.statusCode, 404);
    assert.equal(providerCallCount, 0);
});

test('order timeline scopes ownership and selects only customer-safe fields', async () => {
    const response = createResponse();
    let orderFilter;
    let orderProjection;
    let eventFilter;
    let eventProjection;

    Order.findOne = (filter) => {
        orderFilter = filter;
        return {
            select(projection) {
                orderProjection = projection;
                return {
                    async lean() {
                        return {
                            _id: '507f1f77bcf86cd799439012',
                            orderId: 'ord-owned',
                            localOrderId: 'ord-owned',
                            lastStatus: 'Pending',
                        };
                    },
                };
            },
        };
    };
    OrderEvent.find = (filter) => {
        eventFilter = filter;
        return {
            select(projection) {
                eventProjection = projection;
                return {
                    sort() {
                        return { async lean() { return []; } };
                    },
                };
            },
        };
    };

    await userController.getOrderTimeline(
        { params: { orderId: 'ord-owned' }, user: { databaseId: '507f1f77bcf86cd799439011' } },
        response
    );

    assert.deepEqual(orderFilter, {
        orderId: 'ord-owned', user: '507f1f77bcf86cd799439011',
    });
    assert.match(orderProjection, /pricingSnapshot\.sellingTotalMinor/);
    assert.doesNotMatch(orderProjection, /providerOrderId|providerServiceId|target/);
    assert.deepEqual(eventFilter, {
        orderId: '507f1f77bcf86cd799439012', internalOnly: false,
    });
    assert.equal(eventProjection, 'eventType metadata createdAt');
    assert.equal(response.statusCode, 200);
});
