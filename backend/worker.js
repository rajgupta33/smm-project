require('dotenv').config();

const { randomUUID } = require('crypto');
const { UnrecoverableError, Worker } = require('bullmq');
const { getRuntimeConfig } = require('./config/runtimeConfig');
const { connectToDatabase, disconnectFromDatabase } = require('./utils/serverlessDb');
const {
    DRIP_FEED_QUEUE, ORDER_QUEUE, ORDER_STATUS_QUEUE, PAYMENT_RECONCILE_QUEUE,
    PROVIDER_SYNC_QUEUE, REFILL_QUEUE, createWorkerConnection, closeProducerQueues, getQueue,
    writeWorkerHeartbeat,
} = require('./queues/queueRegistry');
const { dispatchPendingJobs } = require('./services/jobDispatchService');
const { scanOrderStatuses } = require('./services/orderStatusService');
const { processDripFeedRunJob } = require('./workers/dripFeedWorker');
const {
    processOrderSubmissionJob, processPaymentReconciliationJob,
    processProviderSyncJob, scanPendingPayments,
    processRefillSubmissionJob, scanRefillRequests,
} = require('./workers/jobProcessors');

let shuttingDown = false;

async function startWorker() {
    const config = getRuntimeConfig();
    await connectToDatabase();
    const connection = createWorkerConnection();
    const workerId = process.env.RAILWAY_REPLICA_ID || process.env.RAILWAY_SERVICE_ID || randomUUID();
    const workerOptions = { connection, prefix: config.bullmqPrefix, concurrency: 5 };
    const workers = [
        new Worker(DRIP_FEED_QUEUE, async (job) => {
            if (job.name !== 'submit-drip-feed') throw new Error(`Unsupported drip-feed job: ${job.name}`);
            return processDripFeedRunJob(job.data);
        }, workerOptions),
        new Worker(ORDER_QUEUE, async (job) => {
            if (job.name !== 'submit-order') throw new Error(`Unsupported order job: ${job.name}`);
            return processOrderSubmissionJob(job.data);
        }, workerOptions),
        new Worker(PROVIDER_SYNC_QUEUE, async (job) => {
            if (job.name !== 'sync-provider-report') throw new Error(`Unsupported sync job: ${job.name}`);
            try {
                return await processProviderSyncJob({
                    ...job.data,
                    attemptNumber: job.attemptsMade + 1,
                    maxAttempts: job.opts.attempts || 1,
                });
            } catch (error) {
                if (error.retryable === false) throw new UnrecoverableError(error.message);
                throw error;
            }
        }, { ...workerOptions, concurrency: 1 }),
        new Worker(PAYMENT_RECONCILE_QUEUE, async (job) => {
            if (job.name === 'scan-pending-payments') return scanPendingPayments();
            if (job.name === 'reconcile-payment') return processPaymentReconciliationJob(job.data);
            throw new Error(`Unsupported payment job: ${job.name}`);
        }, { ...workerOptions, concurrency: 2 }),
        new Worker(REFILL_QUEUE, async (job) => {
            if (job.name === 'submit-refill') return processRefillSubmissionJob(job.data);
            if (job.name === 'scan-refills') return scanRefillRequests();
            throw new Error(`Unsupported refill job: ${job.name}`);
        }, { ...workerOptions, concurrency: 2 }),
        new Worker(ORDER_STATUS_QUEUE, async (job) => {
            if (job.name !== 'scan-order-status') throw new Error(`Unsupported order-status job: ${job.name}`);
            return scanOrderStatuses();
        }, { ...workerOptions, concurrency: 1 }),
    ];

    await getQueue(PAYMENT_RECONCILE_QUEUE).upsertJobScheduler(
        'pending-payment-reconciliation',
        { every: 60000 },
        {
            name: 'scan-pending-payments',
            data: {},
            opts: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
                removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
            },
        }
    );
    await getQueue(REFILL_QUEUE).upsertJobScheduler(
        'refill-status-reconciliation',
        { every: config.refill.statusPollMinutes * 60 * 1000 },
        {
            name: 'scan-refills', data: {},
            opts: {
                attempts: 3, backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
                removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
            },
        }
    );
    await getQueue(ORDER_STATUS_QUEUE).upsertJobScheduler(
        'order-status-polling',
        { every: config.orderStatus.pollMinutes * 60 * 1000 },
        {
            name: 'scan-order-status', data: {},
            opts: {
                attempts: 3, backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
                removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
            },
        }
    );

    for (const worker of workers) {
        worker.on('failed', (job, error) => {
            console.error(`Job ${job?.id || 'unknown'} failed:`, error.message);
        });
        worker.on('error', (error) => console.error('BullMQ worker error:', error.message));
    }

    await dispatchPendingJobs();
    await writeWorkerHeartbeat(connection, workerId);
    const heartbeatTimer = setInterval(() => {
        writeWorkerHeartbeat(connection, workerId)
            .catch((error) => console.error('Worker heartbeat failed:', error.message));
    }, 15000);
    heartbeatTimer.unref();
    const dispatchTimer = setInterval(() => {
        dispatchPendingJobs().catch((error) => console.error('Outbox dispatch failed:', error.message));
    }, 5000);
    dispatchTimer.unref();

    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`Received ${signal}. Closing background workers...`);
        clearInterval(dispatchTimer);
        clearInterval(heartbeatTimer);
        await Promise.all(workers.map((worker) => worker.close()));
        await closeProducerQueues();
        await connection.quit();
        await disconnectFromDatabase();
    }

    process.once('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
    process.once('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
    console.log('SMM background worker is ready');
    return { workers, shutdown };
}

if (require.main === module) {
    startWorker().catch((error) => {
        console.error('Background worker failed to start:', error);
        process.exitCode = 1;
    });
}

module.exports = { startWorker };
