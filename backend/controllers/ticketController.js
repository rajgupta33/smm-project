const Ticket = require('../models/Ticket');
const TicketMessage = require('../models/TicketMessage');
const {
    TicketError, addMessage, createTicket, updateTicketByAdmin,
} = require('../services/ticketService');

function serializeTicket(ticket, includeInternal = false) {
    const value = typeof ticket?.toObject === 'function' ? ticket.toObject() : ticket;
    if (!value) return null;
    return {
        id: String(value._id), publicTicketId: value.publicTicketId,
        category: value.category, priority: value.priority, status: value.status,
        orderId: value.orderId?.orderId || null,
        ...(includeInternal ? {
            userId: String(value.userId?._id || value.userId),
            customerId: value.userId?.userId || null,
            assignedTo: value.assignedTo ? String(value.assignedTo?._id || value.assignedTo) : null,
            assignedToUserId: value.assignedTo?.userId || null,
            providerTicketReference: value.providerTicketReference || null,
        } : {}),
        lastMessageAt: value.lastMessageAt,
        createdAt: value.createdAt, updatedAt: value.updatedAt,
    };
}

function serializeMessage(message, includeInternal = false) {
    const value = typeof message?.toObject === 'function' ? message.toObject() : message;
    return {
        id: String(value._id), senderType: value.senderType,
        message: value.message, attachments: value.attachments || [],
        ...(includeInternal ? { internalOnly: Boolean(value.internalOnly) } : {}),
        createdAt: value.createdAt,
    };
}

function sendError(res, error) {
    const known = error instanceof TicketError;
    return res.status(known ? error.statusCode : 500).json({
        success: false,
        error: known ? error.message : 'Ticket operation failed',
        code: known ? error.code : 'TICKET_OPERATION_FAILED',
    });
}

async function create(req, res) {
    try {
        const result = await createTicket({
            userId: req.currentUser._id,
            category: req.body?.category,
            publicOrderId: req.body?.orderId,
            message: req.body?.message,
            attachments: req.body?.attachments,
            clientIdempotencyKey: req.get('Idempotency-Key'),
        });
        return res.status(result.idempotentReplay ? 200 : 201).json({
            success: true, data: serializeTicket(result.ticket),
            idempotentReplay: result.idempotentReplay,
        });
    } catch (error) { return sendError(res, error); }
}

async function listMine(req, res) {
    try {
        const data = await Ticket.find({ userId: req.currentUser._id })
            .sort({ updatedAt: -1 }).limit(100).populate('orderId', 'orderId');
        return res.json({ success: true, data: data.map((ticket) => serializeTicket(ticket)) });
    } catch (error) { return sendError(res, error); }
}

async function customerTicket(req) {
    const ticket = await Ticket.findOne({
        publicTicketId: String(req.params.publicTicketId).toUpperCase(),
        userId: req.currentUser._id,
    }).populate('orderId', 'orderId');
    if (!ticket) throw new TicketError('Ticket not found', 'TICKET_NOT_FOUND', 404);
    return ticket;
}

async function getMine(req, res) {
    try {
        const ticket = await customerTicket(req);
        const messages = await TicketMessage.find({ ticketId: ticket._id, internalOnly: false })
            .sort({ createdAt: 1 });
        return res.json({
            success: true,
            data: {
                ticket: serializeTicket(ticket),
                messages: messages.map((message) => serializeMessage(message)),
            },
        });
    } catch (error) { return sendError(res, error); }
}

async function addCustomerMessage(req, res) {
    try {
        const ticket = await customerTicket(req);
        const result = await addMessage({
            ticket, senderType: 'CUSTOMER', senderId: req.currentUser._id,
            message: req.body?.message, attachments: req.body?.attachments,
            internalOnly: false, clientIdempotencyKey: req.get('Idempotency-Key'),
        });
        return res.status(result.idempotentReplay ? 200 : 201).json({
            success: true, data: serializeMessage(result.message),
            ticket: serializeTicket(result.ticket), idempotentReplay: result.idempotentReplay,
        });
    } catch (error) { return sendError(res, error); }
}

function adminFilter(query) {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.category) filter.category = query.category;
    if (query.assignedTo === 'unassigned') filter.assignedTo = null;
    else if (query.assignedTo) filter.assignedTo = query.assignedTo;
    return filter;
}

async function listAdmin(req, res) {
    try {
        const data = await Ticket.find(adminFilter(req.query)).select('+providerTicketReference')
            .sort({ priority: -1, updatedAt: -1 }).limit(200)
            .populate('userId', 'userId').populate('orderId', 'orderId').populate('assignedTo', 'userId');
        return res.json({ success: true, data: data.map((ticket) => serializeTicket(ticket, true)) });
    } catch (error) { return sendError(res, error); }
}

async function adminTicket(req) {
    const ticket = await Ticket.findOne({
        publicTicketId: String(req.params.publicTicketId).toUpperCase(),
    }).select('+providerTicketReference').populate('userId', 'userId')
        .populate('orderId', 'orderId').populate('assignedTo', 'userId');
    if (!ticket) throw new TicketError('Ticket not found', 'TICKET_NOT_FOUND', 404);
    return ticket;
}

async function getAdmin(req, res) {
    try {
        const ticket = await adminTicket(req);
        const messages = await TicketMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 });
        return res.json({
            success: true,
            data: {
                ticket: serializeTicket(ticket, true),
                messages: messages.map((message) => serializeMessage(message, true)),
            },
        });
    } catch (error) { return sendError(res, error); }
}

async function addAdminMessage(req, res) {
    try {
        const ticket = await adminTicket(req);
        const result = await addMessage({
            ticket, senderType: 'ADMIN', senderId: req.currentUser._id,
            message: req.body?.message, attachments: req.body?.attachments,
            internalOnly: req.body?.internalOnly === true,
            clientIdempotencyKey: req.get('Idempotency-Key'),
        });
        return res.status(result.idempotentReplay ? 200 : 201).json({
            success: true, data: serializeMessage(result.message, true),
            ticket: serializeTicket(result.ticket, true), idempotentReplay: result.idempotentReplay,
        });
    } catch (error) { return sendError(res, error); }
}

async function updateAdmin(req, res) {
    try {
        const ticket = await adminTicket(req);
        const result = await updateTicketByAdmin({
            ticket, adminId: req.currentUser._id,
            status: req.body?.status, priority: req.body?.priority,
            assignedTo: req.body?.assignToSelf === true ? req.currentUser._id : req.body?.assignedTo,
            providerTicketReference: req.body?.providerTicketReference,
            clientIdempotencyKey: req.get('Idempotency-Key'),
        });
        return res.json({
            success: true, data: serializeTicket(result.ticket, true),
            idempotentReplay: result.idempotentReplay,
        });
    } catch (error) { return sendError(res, error); }
}

module.exports = {
    addAdminMessage, addCustomerMessage, create, getAdmin, getMine,
    listAdmin, listMine, serializeMessage, serializeTicket, updateAdmin,
};
