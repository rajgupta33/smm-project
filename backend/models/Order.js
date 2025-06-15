const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    },
    rate: {
        type: Number,
        required: true
    },
    service: {
        type: String,
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);

// Status	Meaning
// Pending	Order is received but not yet started.
// Processing	Order is being fulfilled.
// In Progress	Some services have begun; not fully completed.
// Completed	Order is successfully delivered.
// Partial	Only part of the order could be delivered; remaining refunded.
// Canceled	Order was canceled and no services were delivered.
// Refunded	Payment has been returned to your account balance or method.
// Failed	An error occurred; order could not be processed.