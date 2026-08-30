const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { getRuntimeConfig } = require('../config/runtimeConfig');

const ORDER_QUEUE = 'provider-order-submit';
const PROVIDER_SYNC_QUEUE = 'provider-sync';
const PAYMENT_RECONCILE_QUEUE = 'payment-reconcile';
const REFILL_QUEUE = 'provider-refill';
const DRIP_FEED_QUEUE = 'drip-feed-submit';
const ORDER_STATUS_QUEUE = 'order-status-scan';
const WORKER_HEARTBEAT_TTL_SECONDS = 45;

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
            [ORDER_STATUS_QUEUE, new Queue(ORDER_STATUS_QUEUE, options)],
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

function workerHeartbeatKey(config = getRuntimeConfig()) {
    return `${config.bullmqPrefix}:monitor:worker-heartbeat`;
}

function parseWorkerHeartbeat(value, now = Date.now()) {
    if (!value) return { healthy: false, lastHeartbeatAt: null, ageMs: null };
    try {
        const heartbeat = JSON.parse(value);
        const timestamp = new Date(heartbeat.timestamp).getTime();
        if (!Number.isFinite(timestamp)) throw new Error('invalid timestamp');
        const ageMs = Math.max(0, now - timestamp);
        return {
            healthy: ageMs <= WORKER_HEARTBEAT_TTL_SECONDS * 1000,
            lastHeartbeatAt: new Date(timestamp).toISOString(),
            ageMs,
            workerId: heartbeat.workerId || null,
        };
    } catch {
        return { healthy: false, lastHeartbeatAt: null, ageMs: null };
    }
}

async function writeWorkerHeartbeat(connection, workerId) {
    const value = JSON.stringify({ workerId, timestamp: new Date().toISOString() });
    await connection.set(workerHeartbeatKey(), value, 'EX', WORKER_HEARTBEAT_TTL_SECONDS);
}

async function getWorkerHeartbeat() {
    const value = await getProducerConnection().get(workerHeartbeatKey());
    return parseWorkerHeartbeat(value);
}

async function getQueueDiagnostics() {
    const result = {};
    for (const [name, queue] of getQueues()) {
        result[name] = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    }
    return result;
}

async function getRedisReadiness(timeoutMs = 2000) {
    try {
        const connection = getProducerConnection();
        const [pong, policyResult] = await Promise.race([
            Promise.all([
                connection.ping(),
                connection.config('GET', 'maxmemory-policy'),
            ]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis readiness timed out')), timeoutMs)),
        ]);
        const maxmemoryPolicy = Array.isArray(policyResult) ? policyResult[1] : null;
        return {
            connected: pong === 'PONG',
            maxmemoryPolicy,
            noEviction: maxmemoryPolicy === 'noeviction',
        };
    } catch {
        return { connected: false, maxmemoryPolicy: null, noEviction: false };
    }
}

async function checkRedisConnection(timeoutMs = 2000) {
    const readiness = await getRedisReadiness(timeoutMs);
    return readiness.connected;
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
    ORDER_STATUS_QUEUE,
    PAYMENT_RECONCILE_QUEUE,
    PROVIDER_SYNC_QUEUE,
    REFILL_QUEUE,
    checkRedisConnection,
    closeProducerQueues,
    createWorkerConnection,
    getQueueDiagnostics,
    getProducerConnection,
    getQueue,
    getRedisReadiness,
    getWorkerHeartbeat,
    parseWorkerHeartbeat,
    WORKER_HEARTBEAT_TTL_SECONDS,
    writeWorkerHeartbeat,
};
