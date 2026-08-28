const mongoose = require('mongoose');

const OrderEventSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    eventType: {
        type: String,
        enum: [
            'ORDER_CREATED',
            'PRICE_CALCULATED',
            'FUNDS_RESERVED',
            'PROVIDER_SUBMISSION_STARTED',
            'PROVIDER_ACCEPTED',
            'STATUS_CHANGED',
            'PARTIAL',
            'REFILL_REQUESTED',
            'REFILL_COMPLETED',
            'TICKET_CREATED',
            'REFUND_STARTED',
            'REFUND_COMPLETED',
            'ADMIN_NOTE',
            'SUPPORT_MESSAGE',
            'RECONCILIATION_REQUIRED',
            'RECONCILIATION_RESOLVED'
        ],
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    internalOnly: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'orderevents'
});

OrderEventSchema.index({ orderId: 1, createdAt: 1 });

module.exports = mongoose.model('OrderEvent', OrderEventSchema);

