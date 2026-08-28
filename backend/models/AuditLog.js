const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
    actorType: {
        type: String,
        enum: ['USER', 'ADMIN', 'SYSTEM'],
        required: true,
        immutable: true,
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
    },
    targetType: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
    targetId: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
    requestId: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
    before: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
        immutable: true,
    },
    after: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
        immutable: true,
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
        immutable: true,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});

AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
