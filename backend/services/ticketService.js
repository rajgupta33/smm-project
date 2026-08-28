const { createHash } = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const TicketMessage = require('../models/TicketMessage');
const User = require('../models/User');
const { appendOrderEvent } = require('./orderEventService');
const { TICKET_CATEGORIES, TICKET_STATUSES } = require('../models/Ticket');

const ORDER_REQUIRED_CATEGORIES = new Set([
    'DROP', 'PARTIAL', 'STUCK_ORDER', 'WRONG_SERVICE', 'CANCELLATION',
]);

class TicketError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'TicketError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function requireIdempotencyKey(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
        throw new TicketError('A valid Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED');
    }
    return value.trim();
}

function normalizeMessage(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 4000) {
        throw new TicketError('Message must contain between 1 and 4000 characters', 'INVALID_TICKET_MESSAGE');
    }
    return value.trim();
}

function normalizeAttachments(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 5) {
        throw new TicketError('Attachments must be an array of at most five references', 'INVALID_ATTACHMENTS');
    }
    return value.map((attachment) => {
        if (!attachment || typeof attachment !== 'object') {
            throw new TicketError('Attachment reference is invalid', 'INVALID_ATTACHMENTS');
        }
        let parsed;
        try { parsed = new URL(attachment.url); } catch {
            throw new TicketError('Attachment URL is invalid', 'INVALID_ATTACHMENTS');
        }
        const size = Number(attachment.size);
        if (parsed.protocol !== 'https:' || !Number.isSafeInteger(size) || size < 0 || size > 10 * 1024 * 1024 ||
            typeof attachment.name !== 'string' || !attachment.name.trim() || attachment.name.trim().length > 120 ||
            typeof attachment.contentType !== 'string' || !attachment.contentType.trim() || attachment.contentType.length > 100) {
            throw new TicketError('Attachment metadata is invalid', 'INVALID_ATTACHMENTS');
        }
        return {
            name: attachment.name.trim(), url: parsed.toString(),
            contentType: attachment.contentType.trim(), size,
        };
    });
}

function comparableAttachments(value) {
    return (value || []).map((attachment) => ({
        name: attachment.name, url: attachment.url,
        contentType: attachment.contentType, size: attachment.size,
    }));
}

function publicTicketId(userId, idempotencyKey) {
    return `TKT-${createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex').slice(0, 16).toUpperCase()}`;
}

function priorityFor(category) {
    return ['PAYMENT', 'REFUND', 'STUCK_ORDER'].includes(category) ? 'HIGH' : 'NORMAL';
}

function dependencies(overrides = {}) {
    return {
        mongoose: overrides.mongoose || mongoose,
        Order: overrides.Order || Order,
        Ticket: overrides.Ticket || Ticket,
        TicketMessage: overrides.TicketMessage || TicketMessage,
        User: overrides.User || User,
    };
}

async function assertTicketReplay(existing, input, deps) {
    const order = existing.orderId ? await deps.Order.findById(existing.orderId) : null;
    const firstMessage = await deps.TicketMessage.findOne({ ticketId: existing._id })
        .sort({ createdAt: 1 });
    if (existing.category !== input.category || (order?.orderId || null) !== (input.publicOrderId || null) ||
        firstMessage?.message !== input.message ||
        JSON.stringify(comparableAttachments(firstMessage?.attachments)) !== JSON.stringify(input.attachments)) {
        throw new TicketError('Idempotency key is already used for another ticket', 'IDEMPOTENCY_CONFLICT', 409);
    }
}

async function createTicket({ userId, category, publicOrderId, message, attachments, clientIdempotencyKey }, overrides = {}) {
    const deps = dependencies(overrides);
    const idempotencyKey = requireIdempotencyKey(clientIdempotencyKey);
    category = String(category || '').trim().toUpperCase();
    if (!TICKET_CATEGORIES.includes(category)) throw new TicketError('Ticket category is invalid', 'INVALID_TICKET_CATEGORY');
    message = normalizeMessage(message);
    attachments = normalizeAttachments(attachments);
    publicOrderId = typeof publicOrderId === 'string' && publicOrderId.trim() ? publicOrderId.trim() : null;
    if (ORDER_REQUIRED_CATEGORIES.has(category) && !publicOrderId) {
        throw new TicketError('This ticket category requires an order', 'ORDER_REQUIRED');
    }

    const existing = await deps.Ticket.findOne({ userId, idempotencyKey });
    if (existing) {
        await assertTicketReplay(existing, { category, publicOrderId, message, attachments }, deps);
        return { ticket: existing, idempotentReplay: true };
    }

    const session = await deps.mongoose.startSession();
    let ticket;
    try {
        await session.withTransaction(async () => {
            const order = publicOrderId
                ? await deps.Order.findOne({ orderId: publicOrderId, user: userId }).session(session)
                : null;
            if (publicOrderId && !order) throw new TicketError('Order not found', 'ORDER_NOT_FOUND', 404);
            [ticket] = await deps.Ticket.create([{
                publicTicketId: publicTicketId(userId, idempotencyKey),
                userId, orderId: order?._id || null, category,
                priority: priorityFor(category), status: 'OPEN',
                idempotencyKey, lastMessageAt: new Date(),
            }], { session });
            await deps.TicketMessage.create([{
                ticketId: ticket._id, senderType: 'CUSTOMER', senderId: userId,
                message, attachments, internalOnly: false,
                idempotencyKey: `ticket-open:${idempotencyKey}`,
            }], { session });
            if (order) {
                await appendOrderEvent({
                    orderId: order._id,
                    userId,
                    eventType: 'TICKET_CREATED',
                    metadata: { ticketId: ticket._id, publicTicketId: ticket.publicTicketId, category },
                    session
                }).catch(err => console.error('Failed to append TICKET_CREATED event', err));
                await appendOrderEvent({
                    orderId: order._id,
                    userId,
                    eventType: 'SUPPORT_MESSAGE',
                    metadata: { messageSnippet: message.substring(0, 100) },
                    session
                }).catch(err => console.error('Failed to append SUPPORT_MESSAGE event', err));
            }
        });
        return { ticket, idempotentReplay: false };
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const replay = await deps.Ticket.findOne({ userId, idempotencyKey });
        if (!replay) throw error;
        await assertTicketReplay(replay, { category, publicOrderId, message, attachments }, deps);
        return { ticket: replay, idempotentReplay: true };
    } finally {
        await session.endSession();
    }
}

async function addMessage({ ticket, senderType, senderId, message, attachments, internalOnly, clientIdempotencyKey }, overrides = {}) {
    const deps = dependencies(overrides);
    const idempotencyKey = requireIdempotencyKey(clientIdempotencyKey);
    message = normalizeMessage(message);
    attachments = normalizeAttachments(attachments);
    if (senderType === 'CUSTOMER' && internalOnly) {
        throw new TicketError('Customers cannot create internal notes', 'INTERNAL_NOTE_FORBIDDEN', 403);
    }
    if (ticket.status === 'CLOSED') throw new TicketError('Closed tickets cannot receive messages', 'TICKET_CLOSED', 409);
    const existing = await deps.TicketMessage.findOne({ ticketId: ticket._id, idempotencyKey });
    if (existing) {
        if (existing.message !== message || existing.internalOnly !== Boolean(internalOnly) ||
            JSON.stringify(comparableAttachments(existing.attachments)) !== JSON.stringify(attachments)) {
            throw new TicketError('Idempotency key is already used for another message', 'IDEMPOTENCY_CONFLICT', 409);
        }
        return { message: existing, ticket, idempotentReplay: true };
    }

    const session = await deps.mongoose.startSession();
    try {
        let created;
        let updatedTicket;
        await session.withTransaction(async () => {
            [created] = await deps.TicketMessage.create([{
                ticketId: ticket._id, senderType, senderId,
                message, attachments, internalOnly: Boolean(internalOnly), idempotencyKey,
            }], { session });
            const nextStatus = senderType === 'CUSTOMER'
                ? 'WAITING_FOR_SUPPORT'
                : internalOnly ? ticket.status : 'WAITING_FOR_CUSTOMER';
            updatedTicket = await deps.Ticket.findOneAndUpdate(
                { _id: ticket._id, status: { $ne: 'CLOSED' } },
                { $set: { status: nextStatus, lastMessageAt: new Date() } },
                { new: true, session, runValidators: true }
            );
            if (!updatedTicket) throw new TicketError('Ticket state changed concurrently', 'TICKET_STATE_CONFLICT', 409);
            if (updatedTicket.orderId) {
                const eventType = internalOnly ? 'ADMIN_NOTE' : 'SUPPORT_MESSAGE';
                await appendOrderEvent({
                    orderId: updatedTicket.orderId,
                    userId: updatedTicket.userId,
                    eventType,
                    metadata: { messageSnippet: message.substring(0, 100), senderType },
                    internalOnly,
                    session
                }).catch(err => console.error('Failed to append event', err));
            }
        });
        return { message: created, ticket: updatedTicket, idempotentReplay: false };
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const replay = await deps.TicketMessage.findOne({ ticketId: ticket._id, idempotencyKey });
        if (!replay || replay.message !== message || replay.internalOnly !== Boolean(internalOnly) ||
            JSON.stringify(comparableAttachments(replay.attachments)) !== JSON.stringify(attachments)) {
            throw new TicketError('Idempotency key is already used for another message', 'IDEMPOTENCY_CONFLICT', 409);
        }
        return { message: replay, ticket: await deps.Ticket.findById(ticket._id), idempotentReplay: true };
    } finally {
        await session.endSession();
    }
}

async function updateTicketByAdmin({ ticket, adminId, status, assignedTo, priority, providerTicketReference, clientIdempotencyKey }, overrides = {}) {
    const deps = dependencies(overrides);
    const idempotencyKey = requireIdempotencyKey(clientIdempotencyKey);
    const changes = {};
    if (status !== undefined) {
        status = String(status).toUpperCase();
        if (!TICKET_STATUSES.includes(status)) throw new TicketError('Ticket status is invalid', 'INVALID_TICKET_STATUS');
        changes.status = status;
    }
    if (priority !== undefined) {
        priority = String(priority).toUpperCase();
        if (!['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) {
            throw new TicketError('Ticket priority is invalid', 'INVALID_TICKET_PRIORITY');
        }
        changes.priority = priority;
    }
    if (assignedTo !== undefined) {
        if (assignedTo === null || assignedTo === '') changes.assignedTo = null;
        else {
            const assignee = await deps.User.findOne({ _id: assignedTo, role: 'admin' });
            if (!assignee) throw new TicketError('Assigned administrator is invalid', 'INVALID_TICKET_ASSIGNEE');
            changes.assignedTo = assignee._id;
        }
    }
    if (providerTicketReference !== undefined) {
        if (providerTicketReference !== null &&
            (typeof providerTicketReference !== 'string' || providerTicketReference.trim().length > 200)) {
            throw new TicketError('Provider ticket reference is invalid', 'INVALID_PROVIDER_TICKET_REFERENCE');
        }
        changes.providerTicketReference = providerTicketReference?.trim() || null;
    }
    if (!Object.keys(changes).length) throw new TicketError('No ticket changes were supplied', 'EMPTY_TICKET_UPDATE');

    const eventChanges = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value === null ? null : String(value)]));
    const eventMessage = `Admin updated ticket: ${JSON.stringify(eventChanges)}`;
    const existingEvent = await deps.TicketMessage.findOne({ ticketId: ticket._id, idempotencyKey });
    if (existingEvent) {
        if (existingEvent.message !== eventMessage) {
            throw new TicketError('Idempotency key is already used for another ticket update', 'IDEMPOTENCY_CONFLICT', 409);
        }
        return { ticket: await deps.Ticket.findById(ticket._id), idempotentReplay: true };
    }
    const session = await deps.mongoose.startSession();
    try {
        let updated;
        await session.withTransaction(async () => {
            updated = await deps.Ticket.findOneAndUpdate(
                { _id: ticket._id }, { $set: changes },
                { new: true, session, runValidators: true }
            );
            await deps.TicketMessage.create([{
                ticketId: ticket._id, senderType: 'SYSTEM', senderId: adminId,
                message: eventMessage,
                attachments: [], internalOnly: true, idempotencyKey,
            }], { session });
        });
        return { ticket: updated, idempotentReplay: false };
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const replay = await deps.TicketMessage.findOne({ ticketId: ticket._id, idempotencyKey });
        if (!replay || replay.message !== eventMessage) {
            throw new TicketError('Idempotency key is already used for another ticket update', 'IDEMPOTENCY_CONFLICT', 409);
        }
        return { ticket: await deps.Ticket.findById(ticket._id), idempotentReplay: true };
    } finally { await session.endSession(); }
}

module.exports = {
    ORDER_REQUIRED_CATEGORIES,
    TicketError,
    addMessage,
    createTicket,
    comparableAttachments,
    normalizeAttachments,
    normalizeMessage,
    priorityFor,
    publicTicketId,
    updateTicketByAdmin,
};
