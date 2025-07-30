const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        required: true,
        unique: true
    },
    lastStatus: {
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
    },
    refill: {
        type: String,
        default: null
    },
    start_count: {
        type: String,
    }
}, { timestamps: true });

OrderSchema.index({ user: 1 }); 
OrderSchema.index({ user: 1, createdAt: -1 }); 
OrderSchema.index({ orderId: 1 });

module.exports = mongoose.model('Order', OrderSchema);