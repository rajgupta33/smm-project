const mongoose = require('mongoose');

const ManualTaskSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        unique: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    dueAt: {
        type: Date,
        default: null
    },
    claimedAt: {
        type: Date,
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    notes: {
        type: String,
        default: '',
        maxlength: 4000,
        trim: true
    },
    proof: {
        type: String,
        default: '',
        maxlength: 2000,
        trim: true
    },
    status: {
        type: String,
        enum: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELLED'],
        default: 'PENDING'
    }
}, {
    timestamps: true,
    optimisticConcurrency: true
});

ManualTaskSchema.index({ status: 1, createdAt: 1 });
ManualTaskSchema.index({ assignedTo: 1 });
ManualTaskSchema.index({ status: 1, dueAt: 1 });

module.exports = mongoose.model('ManualTask', ManualTaskSchema);

