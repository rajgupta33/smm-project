const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { getRuntimeConfig } = require('../config/runtimeConfig');

const ORDER_QUEUE = 'provider-order-submit';
const PROVIDER_SYNC_QUEUE = 'provider-sync';
const PAYMENT_RECONCILE_QUEUE = 'payment-reconcile';
const REFILL_QUEUE = 'provider-refill';
const DRIP_FEED_QUEUE = 'drip-feed-submit';

let producerConnection;
let queues;

function getProducerConnection() {
    if (!producerConnection) {
        const config = getRuntimeConfig();
        producerConnection = new IORedis(config.redisUrl, {
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
            connectTimeout: 3000,
        });
        producerConnection.on('error', (error) => {
            console.error('Redis producer connection error:', error.message);
        });
    }
    return producerConnection;
}

function getQueues() {
    if (!queues) {
        const config = getRuntimeConfig();
        const options = {
            connection: getProducerConnection(),
            prefix: config.bullmqPrefix,
            skipWaitingForReady: true,
        };
        queues = new Map([
            [ORDER_QUEUE, new Queue(ORDER_QUEUE, options)],
            [PROVIDER_SYNC_QUEUE, new Queue(PROVIDER_SYNC_QUEUE, options)],
            [PAYMENT_RECONCILE_QUEUE, new Queue(PAYMENT_RECONCILE_QUEUE, options)],
            [REFILL_QUEUE, new Queue(REFILL_QUEUE, options)],
            [DRIP_FEED_QUEUE, new Queue(DRIP_FEED_QUEUE, options)],
        ]);
    }
    return queues;
}

function getQueue(queueName) {
    const queue = getQueues().get(queueName);
    if (!queue) throw new Error(`Unsupported queue: ${queueName}`);
    return queue;
}

function createWorkerConnection() {
    const config = getRuntimeConfig();
    const connection = new IORedis(config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
    });
    connection.on('error', (error) => {
        console.error('Redis worker connection error:', error.message);
    });
    return connection;
}

async function closeProducerQueues() {
    if (queues) await Promise.all([...queues.values()].map((queue) => queue.close()));
    queues = undefined;
    if (producerConnection) await producerConnection.quit();
    producerConnection = undefined;
}

module.exports = {
    DRIP_FEED_QUEUE,
    ORDER_QUEUE,
    PAYMENT_RECONCILE_QUEUE,
    PROVIDER_SYNC_QUEUE,
    REFILL_QUEUE,
    closeProducerQueues,
    createWorkerConnection,
    getQueue,
};
