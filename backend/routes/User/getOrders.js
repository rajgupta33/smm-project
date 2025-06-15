const express = require('express');
const router = express.Router();
const db = require('../../utils/db');
const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.API_KEY;
const apiUrl = process.env.API_URL;
// Mock data for demonstration
//  const orders = [
//   {
//     orderId: 12345,
//     service: "Premium Service",
//     quantity: 2,
//     status: 'pending',
//     cost: 99.99
//   },
//   {
//     orderId: 12346,
//     service: "Basic Service",
//     quantity: 1,
//     status: 'complete',
//     cost: 49.99
//   },
//   {
//     orderId: 12347,
//     service: "Standard Service",
//     quantity: 3,
//     status: 'cancelled',
//     cost: 89.97
//   },
//   {
//     orderId: 12348,
//     service: "Premium Service",
//     quantity: 1,
//     status: 'pending',
//     cost: 49.99
//   },
//   {
//     orderId: 12349,
//     service: "Basic Service",
//     quantity: 2,
//     status: 'complete',
//     cost: 99.98
//   }
// ];
// GET /user/orders - Get all orders
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await db.collection('users').findOne({ userId });

    const orders = await db.collection('orders').find({ user: user._id }).toArray();

    const pendingOrders = orders.filter(order => order.status !== 'Completed' || order.status !== 'Cancelled');

    // Update status of all pending orders
    // Batch pending order IDs in groups of 100
    const batchSize = 100;
    for (let i = 0; i < pendingOrders.length; i += batchSize) {
      const batch = pendingOrders.slice(i, i + batchSize);
      const orderIds = batch.map(order => order.orderId).join(',');

      const statusParams = {
        key: apiKey,
        action: 'status',
        orders: orderIds
      };

      try {
        const statusResponse = await axios.post(apiUrl, null, { params: statusParams });
        // Assume statusResponse.data is an object: { [orderId]: { status: '...' }, ... }
        const statusData = statusResponse.data;

        for (const order of batch) {
          const newStatus = statusData[order.orderId]?.status || "Pending";
          if (order.status !== newStatus) {
            await db.collection('orders').updateOne(
              { _id: order._id },
              { $set: { status: newStatus } }
            );
            order.status = newStatus;
          }
        }
      } catch (err) {
        // Optionally log error or handle as needed
      }
    }
    res.status(200).json({ data: orders });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while fetching orders.' });
  }
});

module.exports = router;