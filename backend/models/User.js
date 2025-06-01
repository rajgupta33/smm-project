const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    amount: { type: Number, required: true },
    orderId: { type: Number, required: true },
    date: { type: Date, default: Date.now }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    orderId: { type: Number, required: true },
    service: { type: String, required: true },
    quantity: { type: Number, required: true },
    status: {type : String},
    cost: { type: Number, required: true }
}, { _id: false });

const UserSchema = new mongoose.Schema({
    userId: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    money: { type: Number, default: 0 },
    role: { type: String, required: true },
    services: [{
        serviceId: { type: String, required: true },
        rate: { type: Number, required: true }
    }],
    transactions: [TransactionSchema],
    orders: [OrderSchema]
});

module.exports = mongoose.model('User', UserSchema);