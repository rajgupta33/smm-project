const mongoose = require('mongoose');

const JobDispatchSchema = new mongoose.Schema({
    jobKey: { type: String, required: true, unique: true, trim: true, immutable: true },
    queueName: {
        type: String,
        enum: ['provider-order-submit', 'provider-sync', 'provider-refill', 'drip-feed-submit'],
        required: true,
        immutable: true,
    },
    jobName: {
        type: String,
        enum: ['submit-order', 'sync-provider-report', 'submit-refill', 'submit-drip-feed'],
        required: true,
        immutable: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    runAt: { type: Date, default: Date.now, required: true, immutable: true },
    status: {
        type: String,
        enum: ['PENDING', 'DISPATCHING', 'ENQUEUED'],
        default: 'PENDING',
        required: true,
    },
    dispatchAttempts: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    nextAttemptAt: { type: Date, default: Date.now, required: true },
    lockedUntil: { type: Date, default: null },
    enqueuedAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
}, { timestamps: true });

JobDispatchSchema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });

module.exports = mongoose.model('JobDispatch', JobDispatchSchema);
