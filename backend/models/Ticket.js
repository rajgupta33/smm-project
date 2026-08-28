const mongoose = require('mongoose');

const TICKET_CATEGORIES = [
    'DROP', 'PARTIAL', 'STUCK_ORDER', 'WRONG_SERVICE', 'CANCELLATION',
    'PAYMENT', 'REFUND', 'OTHER',
];
const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const TICKET_STATUSES = [
    'OPEN', 'WAITING_FOR_SUPPORT', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED',
];

const TicketSchema = new mongoose.Schema({
    publicTicketId: { type: String, required: true, unique: true, trim: true, uppercase: true, immutable: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, immutable: true },
    category: { type: String, enum: TICKET_CATEGORIES, required: true, immutable: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'NORMAL', required: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'OPEN', required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    providerTicketReference: { type: String, trim: true, default: null, select: false },
    idempotencyKey: { type: String, required: true, trim: true, immutable: true },
    lastMessageAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

TicketSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
TicketSchema.index({ userId: 1, updatedAt: -1 });
TicketSchema.index({ status: 1, priority: -1, updatedAt: -1 });
TicketSchema.index({ assignedTo: 1, status: 1, updatedAt: -1 });
TicketSchema.index({ orderId: 1, createdAt: -1 });

module.exports = mongoose.model('Ticket', TicketSchema);
module.exports.TICKET_CATEGORIES = TICKET_CATEGORIES;
module.exports.TICKET_PRIORITIES = TICKET_PRIORITIES;
module.exports.TICKET_STATUSES = TICKET_STATUSES;
