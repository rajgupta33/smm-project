const express = require('express');
const router = express.Router();
const db = require('../../utils/db');


//   const payments = [
//   {
//     amount: 99.99,
//     orderId: 12345,
//     date: new Date('2025-05-30')
//   },
//   {
//     amount: 49.99,
//     orderId: 12346,
//     date: new Date('2025-05-29')
//   },
//   {
//     amount: 89.97,
//     orderId: 12347,
//     date: new Date('2025-05-28')
//   },
//   {
//     amount: 49.99,
//     orderId: 12348,
//     date: new Date('2025-05-31')
//   },
//   {
//     amount: 99.98,
//     orderId: 12349,
//     date: new Date('2025-05-27')
//   }
// ];

// Example: Get all transactions for a user
router.get('/', async (req, res) => {
    try {
      const userId = req.user.id;

      const user = await db.collection('users').findOne({ userId });

      const payments = await db.collection('transactions').find({user:user._id}).toArray();


      res.status(200).json({data: payments});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

module.exports = router;