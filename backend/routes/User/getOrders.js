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
        // userId from authenticated user (assuming it's a unique string, not MongoDB's _id)
        const userId = req.user.id; // e.g., 'user123' from your UserSchema.userId

        // --- Pagination Parameters ---
        const page = parseInt(req.params.page) || 1;
        const limit = parseInt(req.params.limit) || 10;
        const skip = (page - 1) * limit;

        // 1. Find the user document to get their MongoDB _id
        const user = await db.collection('users').findOne({ userId });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const userObjectId = user._id; // This is the ObjectId we use for references

        // 2. Fetch orders for this user with pagination
        // Ensure you have an index on 'user' and 'createdAt' in the 'orders' collection for performance
        const orders = await db.collection('orders')
                               .find({ user: userObjectId })
                               .sort({ createdAt: -1 }) // Sort by creation date, newest first, crucial for consistent pagination
                               .skip(skip)
                               .limit(limit)
                               .toArray();

        // 3. Filter for pending orders from the CURRENTLY FETCHED PAGE
        const pendingOrders = orders.filter(order =>
          order.status.toLowerCase() !== 'completed' && order.status.toLowerCase() !== 'cancelled'
        );

        // 4. Update status of these pending orders by calling external API in batches
        const batchSize = 100; // Number of orders to query in a single external API call

        for (let i = 0; i < pendingOrders.length; i += batchSize) {
            const batch = pendingOrders.slice(i, i + batchSize);
            const externalOrderIds = batch.map(order => order.orderId); // Assuming 'orderid' is the external ID

            if (externalOrderIds.length === 0) continue;

            const statusParams = {
                key: apiKey,
                action: 'status',
                orders: externalOrderIds.join(',')
            };

            try {
                const statusResponse = await axios.post(apiUrl, null, { params: statusParams });
                const statusData = statusResponse.data;

                const bulkOps = [];
                for (const order of batch) {
                    const newStatus = statusData[order.orderid]?.status;
                    
                    if (newStatus && order.status !== newStatus) {
                        bulkOps.push({
                            updateOne: {
                                filter: { _id: order._id },
                                update: { $set: { status: newStatus } }
                            }
                        });
                        // Optimistically update the 'orders' array in memory for the response
                        order.status = newStatus;
                    }
                }

                if (bulkOps.length > 0) {
                    await db.collection('orders').bulkWrite(bulkOps);
                }

            } catch (err) {
                console.error(`Error fetching status for order batch from external API for user ${userIdString} (page ${page}):`, err.message);
                // Log or handle the error without blocking the entire request
            }
        }

        // 5. Send the paginated and potentially updated orders data to the frontend
        res.status(200).json({ success: true, data: orders });

    } catch (error) {
        console.error('Error in /orders route:', error);
        res.status(500).json({ success: false, message: 'Server Error: An error occurred while fetching and updating orders.' });
    }
});

module.exports = router;
