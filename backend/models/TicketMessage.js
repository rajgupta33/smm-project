const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
    url: { type: String, required: true, trim: true, maxlength: 2000, immutable: true },
    contentType: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
    size: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
}, { _id: false });

const TicketMessageSchema = new mongoose.Schema({
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, immutable: true },
    senderType: { type: String, enum: ['CUSTOMER', 'ADMIN', 'SYSTEM'], required: true, immutable: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
    message: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000, immutable: true },
    attachments: { type: [AttachmentSchema], default: [], immutable: true },
    internalOnly: { type: Boolean, default: false, required: true, immutable: true },
    idempotencyKey: { type: String, required: true, trim: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

TicketMessageSchema.index({ ticketId: 1, idempotencyKey: 1 }, { unique: true });
TicketMessageSchema.index({ ticketId: 1, createdAt: 1 });

module.exports = mongoose.model('TicketMessage', TicketMessageSchema);
