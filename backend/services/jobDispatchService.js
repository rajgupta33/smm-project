const JobDispatch = require('../models/JobDispatch');
const {
    getQueue, ORDER_QUEUE, PROVIDER_SYNC_QUEUE, REFILL_QUEUE,
    DRIP_FEED_QUEUE,
} = require('../queues/queueRegistry');

const DISPATCH_LEASE_MS = 30000;

function orderDispatchDocument(orderId) {
    const value = String(orderId);
    return {
        jobKey: `order-${value}`,
        queueName: ORDER_QUEUE,
        jobName: 'submit-order',
        payload: { orderId: value },
    };
}

function providerSyncDispatchDocument(runId) {
    const value = String(runId);
    return {
        jobKey: `sync-${value}`,
        queueName: PROVIDER_SYNC_QUEUE,
        jobName: 'sync-provider-report',
        payload: { runId: value },
    };
}

function refillDispatchDocument(refillRequestId) {
    const value = String(refillRequestId);
    return {
        jobKey: `refill-${value}`,
        queueName: REFILL_QUEUE,
        jobName: 'submit-refill',
        payload: { refillRequestId: value },
    };
}

function dripFeedDispatchDocument(runId, parentId, runNumber, scheduledAt = new Date()) {
    const runValue = String(runId);
    const parentValue = String(parentId);
    return {
        jobKey: `drip:${parentValue}:${runNumber}`,
        queueName: DRIP_FEED_QUEUE,
        jobName: 'submit-drip-feed',
        payload: { runId: runValue },
        runAt: new Date(scheduledAt),
    };
}

async function createDispatch(document, session, DispatchModel = JobDispatch) {
    const [dispatch] = await DispatchModel.create([document], { session });
    return dispatch;
}

function jobOptions(dispatch) {
    const syncJob = dispatch.queueName === PROVIDER_SYNC_QUEUE;
    const delay = Math.max(0, new Date(dispatch.runAt || 0).getTime() - Date.now());
    return {
        jobId: dispatch.jobKey,
        attempts: syncJob ? 3 : 1,
        ...(delay > 0 ? { delay } : {}),
        ...(syncJob ? { backoff: { type: 'exponential', delay: 5000 } } : {}),
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
    };
}

async function claimDispatch(filter, now = new Date()) {
    return JobDispatch.findOneAndUpdate(
        {
            ...filter,
            $or: [
                { status: 'PENDING', nextAttemptAt: { $lte: now } },
                { status: 'DISPATCHING', lockedUntil: { $lte: now } },
            ],
        },
        {
            $set: {
                status: 'DISPATCHING',
                lockedUntil: new Date(now.getTime() + DISPATCH_LEASE_MS),
                lastErrorCode: null,
            },
            $inc: { dispatchAttempts: 1 },
        },
        { new: true }
    );
}

async function dispatchClaimed(dispatch, dependencies = {}) {
    const resolveQueue = dependencies.getQueue || getQueue;
    const DispatchModel = dependencies.JobDispatch || JobDispatch;
    try {
        const queue = resolveQueue(dispatch.queueName);
        await queue.add(dispatch.jobName, dispatch.payload, jobOptions(dispatch));
        await DispatchModel.updateOne(
            { _id: dispatch._id, status: 'DISPATCHING' },
            {
                $set: { status: 'ENQUEUED', enqueuedAt: new Date(), lockedUntil: null },
            }
        );
        return { dispatched: true, dispatchStatus: 'ENQUEUED', jobKey: dispatch.jobKey };
    } catch (error) {
        const delaySeconds = Math.min(300, 2 ** Math.min(dispatch.dispatchAttempts, 8));
        await DispatchModel.updateOne(
            { _id: dispatch._id, status: 'DISPATCHING' },
            {
                $set: {
                    status: 'PENDING',
                    nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
                    lockedUntil: null,
                    lastErrorCode: error.code || 'REDIS_DISPATCH_FAILED',
                    lastErrorAt: new Date(),
                },
            }
        ).catch(() => {});
        return { dispatched: false, dispatchStatus: 'PENDING', jobKey: dispatch.jobKey, error };
    }
}

async function dispatchByJobKey(jobKey, dependencies = {}) {
    const claim = dependencies.claimDispatch || claimDispatch;
    const dispatch = await claim({ jobKey });
    if (!dispatch) {
        const DispatchModel = dependencies.JobDispatch || JobDispatch;
        const existing = await DispatchModel.findOne({ jobKey }).select('status').lean();
        return {
            dispatched: false,
            dispatchStatus: existing?.status || null,
            jobKey,
            alreadyHandled: true,
        };
    }
    return dispatchClaimed(dispatch, dependencies);
}

async function dispatchPendingJobs(limit = 100, dependencies = {}) {
    const results = [];
    for (let index = 0; index < limit; index += 1) {
        const claim = dependencies.claimDispatch || claimDispatch;
        const dispatch = await claim({});
        if (!dispatch) break;
        results.push(await dispatchClaimed(dispatch, dependencies));
    }
    return results;
}


module.exports = {
    createDispatch,
    dripFeedDispatchDocument,
    dispatchByJobKey,
    dispatchClaimed,
    dispatchPendingJobs,
    jobOptions,
    orderDispatchDocument,
    providerSyncDispatchDocument,
    refillDispatchDocument,
};
