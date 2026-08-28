const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const refillController = require('../controllers/refillController');
const ticketController = require('../controllers/ticketController');

router.post('/placeOrder', userController.placeOrder);
router.get('/getOrders', userController.getOrders);
router.get('/orders/:orderId', userController.getOrderTimeline);
router.get('/getTransactions', userController.getTransactions);
router.get('/userServices', userController.getUserService);
router.post('/requestRefill', refillController.create);
router.post('/requestRefillStatus', refillController.legacyStatus);
router.post('/refills', refillController.create);
router.get('/refills', refillController.listMine);
router.get('/refills/:refillRequestId', refillController.getMine);
router.post('/tickets', ticketController.create);
router.get('/tickets', ticketController.listMine);
router.get('/tickets/:publicTicketId', ticketController.getMine);
router.post('/tickets/:publicTicketId/messages', ticketController.addCustomerMessage);
router.post('/getOrderStatus', userController.getOrderStatus);
router.put('/changePassword', userController.changePassword);

module.exports = router;
