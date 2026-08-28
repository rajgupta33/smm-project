const assert = require('node:assert/strict');
const test = require('node:test');

const Ticket = require('../models/Ticket');
const TicketMessage = require('../models/TicketMessage');
const {
    addMessage, createTicket, normalizeAttachments, publicTicketId, updateTicketByAdmin,
} = require('../services/ticketService');

function query(value) {
    return {
        sort() { return this; }, populate() { return this; }, select() { return this; },
        session: async () => value,
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function transactionHarness() {
    const session = {
        async withTransaction(callback) { await callback(); },
        async endSession() {},
    };
    return { session, mongoose: { async startSession() { return session; } } };
}

test('ticket models enforce public identity, message idempotency, and safe secret selection', () => {
    const ticketIndexes = Ticket.schema.indexes();
    const messageIndexes = TicketMessage.schema.indexes();
    assert.ok(ticketIndexes.some(([fields, options]) => fields.publicTicketId === 1 && options.unique));
    assert.ok(ticketIndexes.some(([fields, options]) => fields.userId === 1 && fields.idempotencyKey === 1 && options.unique));
    assert.ok(messageIndexes.some(([fields, options]) => fields.ticketId === 1 && fields.idempotencyKey === 1 && options.unique));
    assert.equal(Ticket.schema.path('providerTicketReference').options.select, false);
    assert.equal(TicketMessage.schema.path('message').options.immutable, true);
});

test('ticket public IDs are deterministic without exposing the customer database ID', () => {
    const first = publicTicketId('507f1f77bcf86cd799439011', 'request-1');
    assert.equal(first, publicTicketId('507f1f77bcf86cd799439011', 'request-1'));
    assert.match(first, /^TKT-[A-F0-9]{16}$/);
    assert.equal(first.includes('507f1f77'), false);
});

test('ticket creation checks order ownership and stores ticket plus first message transactionally', async () => {
    const { session, mongoose } = transactionHarness();
    let orderFilter;
    const created = [];
    const result = await createTicket({
        userId: 'user-1', category: 'DROP', publicOrderId: 'ord_1',
        message: 'Followers dropped after completion.', attachments: [],
        clientIdempotencyKey: 'request-1',
    }, {
        mongoose,
        Ticket: {
            findOne: () => query(null),
            async create(documents, options) {
                assert.equal(options.session, session);
                const ticket = { ...documents[0], _id: 'ticket-1' };
                created.push(ticket); return [ticket];
            },
        },
        TicketMessage: {
            async create(documents, options) { assert.equal(options.session, session); created.push(documents[0]); return documents; },
        },
        Order: {
            findOne(filter) { orderFilter = filter; return query({ _id: 'order-db-1', orderId: 'ord_1' }); },
        },
    });
    assert.deepEqual(orderFilter, { orderId: 'ord_1', user: 'user-1' });
    assert.equal(created[0].priority, 'NORMAL');
    assert.equal(created[1].senderType, 'CUSTOMER');
    assert.equal(created[1].internalOnly, false);
    assert.equal(result.ticket.publicTicketId.startsWith('TKT-'), true);
});

test('order-related categories cannot open tickets without an owned order', async () => {
    await assert.rejects(createTicket({
        userId: 'user-1', category: 'PARTIAL', message: 'Partial order',
        clientIdempotencyKey: 'request-1',
    }, {}), (error) => error.code === 'ORDER_REQUIRED');
});

test('unsafe attachment references and customer internal notes are rejected', async () => {
    assert.throws(() => normalizeAttachments([{
        name: 'proof.html', url: 'javascript:alert(1)', contentType: 'text/html', size: 1,
    }]), (error) => error.code === 'INVALID_ATTACHMENTS');
    await assert.rejects(addMessage({
        ticket: { _id: 'ticket-1', status: 'OPEN' }, senderType: 'CUSTOMER', senderId: 'user-1',
        message: 'hidden', attachments: [], internalOnly: true, clientIdempotencyKey: 'message-1',
    }), (error) => error.code === 'INTERNAL_NOTE_FORBIDDEN');
});

test('customer replies are idempotent and move the ticket to support ownership', async () => {
    const { session, mongoose } = transactionHarness();
    const ticket = { _id: 'ticket-1', status: 'WAITING_FOR_CUSTOMER' };
    let storedMessage;
    const deps = {
        mongoose,
        TicketMessage: {
            findOne: () => query(storedMessage || null),
            async create(documents, options) { assert.equal(options.session, session); storedMessage = { ...documents[0], _id: 'message-1' }; return [storedMessage]; },
        },
        Ticket: {
            async findOneAndUpdate(filter, update) { void filter; Object.assign(ticket, update.$set); return ticket; },
            async findById() { return ticket; },
        },
    };
    const input = {
        ticket, senderType: 'CUSTOMER', senderId: 'user-1', message: 'Here are more details.',
        attachments: [], internalOnly: false, clientIdempotencyKey: 'message-1',
    };
    const first = await addMessage(input, deps);
    const replay = await addMessage(input, deps);
    assert.equal(first.ticket.status, 'WAITING_FOR_SUPPORT');
    assert.equal(replay.idempotentReplay, true);
});

test('admin assignment accepts only a current database administrator', async () => {
    await assert.rejects(updateTicketByAdmin({
        ticket: { _id: 'ticket-1' }, adminId: 'admin-1', assignedTo: 'normal-user',
        clientIdempotencyKey: 'update-1',
    }, {
        User: { async findOne() { return null; } },
    }), (error) => error.code === 'INVALID_TICKET_ASSIGNEE');
});
