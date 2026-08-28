const OrderEvent = require('../models/OrderEvent');

/**
 * Appends a new event to the order timeline.
 * 
 * @param {Object} params
 * @param {ObjectId|string} params.orderId - The ID of the order.
 * @param {ObjectId|string} params.userId - The ID of the user.
 * @param {string} params.eventType - The type of the event.
 * @param {Object} [params.metadata={}] - Optional metadata for the event.
 * @param {boolean} [params.internalOnly=false] - Whether the event is internal (hidden from users).
 * @param {ClientSession} [params.session=null] - Optional Mongoose session for transactions.
 */
async function appendOrderEvent({
    orderId,
    userId,
    eventType,
    metadata = {},
    internalOnly = false,
    session = null
}) {
    const event = new OrderEvent({
        orderId,
        userId,
        eventType,
        metadata,
        internalOnly
    });

    if (session) {
        await event.save({ session });
    } else {
        await event.save();
    }

    return event;
}

module.exports = {
    appendOrderEvent
};

