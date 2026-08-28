const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const Ticket = require('../models/Ticket');
const TicketMessage = require('../models/TicketMessage');
const ticketController = require('../controllers/ticketController');

const originalTicketFindOne = Ticket.findOne;
const originalMessageFind = TicketMessage.find;

function query(value) {
    return {
        populate() { return this; }, sort() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

afterEach(() => {
    Ticket.findOne = originalTicketFindOne;
    TicketMessage.find = originalMessageFind;
});

test('customer ticket detail scopes ownership and excludes internal notes in the database query', async () => {
    let ticketFilter;
    let messageFilter;
    Ticket.findOne = (filter) => {
        ticketFilter = filter;
        return query({ _id: 'ticket-db-1', publicTicketId: 'TKT-ABC', userId: 'user-1', category: 'OTHER', status: 'OPEN' });
    };
    TicketMessage.find = (filter) => { messageFilter = filter; return query([]); };
    const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    await ticketController.getMine({
        params: { publicTicketId: 'tkt-abc' }, currentUser: { _id: 'user-1' },
    }, response);
    assert.deepEqual(ticketFilter, { publicTicketId: 'TKT-ABC', userId: 'user-1' });
    assert.deepEqual(messageFilter, { ticketId: 'ticket-db-1', internalOnly: false });
    assert.equal(response.statusCode, 200);
});
