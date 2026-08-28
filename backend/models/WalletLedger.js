const mongoose = require('mongoose');

const integerMinorUnit = {
    validator: Number.isSafeInteger,
    message: '{PATH} must be a safe integer number of paise',
};

const WalletLedgerSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    direction: {
        type: String,
        enum: ['CREDIT', 'DEBIT'],
        required: true,
        immutable: true,
    },
    type: {
        type: String,
        enum: ['PAYMENT', 'ORDER', 'REFUND', 'ADMIN_ADJUSTMENT', 'PROMOTIONAL', 'REVERSAL'],
        required: true,
        immutable: true,
    },
    amountMinor: {
        type: Number,
        required: true,
        min: 1,
        validate: integerMinorUnit,
        immutable: true,
    },
    currency: {
        type: String,
        enum: ['INR'],
        default: 'INR',
        immutable: true,
    },
    balanceBeforeMinor: {
        type: Number,
        required: true,
        min: 0,
        validate: integerMinorUnit,
        immutable: true,
    },
    balanceAfterMinor: {
        type: Number,
        required: true,
        min: 0,
        validate: integerMinorUnit,
        immutable: true,
    },
    sourceType: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
    sourceId: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
    idempotencyKey: {
        type: String,
        required: true,
        trim: true,
        maxlength: 300,
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
    description: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});

WalletLedgerSchema.index({ idempotencyKey: 1 }, { unique: true });
WalletLedgerSchema.index({ userId: 1, createdAt: -1 });
WalletLedgerSchema.index({ sourceType: 1, sourceId: 1 });

function rejectMutation() {
    throw new Error('WalletLedger entries are immutable');
}

for (const operation of [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findOneAndReplace',
    'findOneAndUpdate',
    'replaceOne',
    'updateOne',
    'updateMany',
]) {
    WalletLedgerSchema.pre(operation, rejectMutation);
}

module.exports = mongoose.model('WalletLedger', WalletLedgerSchema);
