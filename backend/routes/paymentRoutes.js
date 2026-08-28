const express = require('express');
const paymentController = require('../controllers/paymentController');

const router = express.Router();

router.get('/config', paymentController.getConfig);
router.post('/orders', paymentController.createOrder);
router.post('/cashfree/order', paymentController.createOrder);
router.get('/orders', paymentController.listMine);
router.get('/orders/:merchantOrderId', paymentController.getMine);

module.exports = router;
