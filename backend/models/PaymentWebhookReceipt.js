const mongoose = require('mongoose');

const PaymentWebhookReceiptSchema = new mongoose.Schema({
    eventKey: { type: String, required: true, unique: true, trim: true, immutable: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, immutable: true },
    eventType: { type: String, required: true, trim: true, immutable: true },
    gatewayPaymentId: { type: String, default: null, trim: true, immutable: true },
    webhookVersion: { type: String, default: null, trim: true, immutable: true },
    receivedAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { timestamps: false });

PaymentWebhookReceiptSchema.index({ paymentId: 1, receivedAt: -1 });

module.exports = mongoose.model('PaymentWebhookReceipt', PaymentWebhookReceiptSchema);
