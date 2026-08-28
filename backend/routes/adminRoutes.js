const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const pricingController = require('../controllers/pricingController');
const catalogueController = require('../controllers/catalogueController');
const operationsController = require('../controllers/operationsController');
const paymentController = require('../controllers/paymentController');
const refillController = require('../controllers/refillController');
const ticketController = require('../controllers/ticketController');
const manualTaskController = require('../controllers/manualTaskController');
const analyticsController = require('../controllers/analyticsController');

router.get('/analytics/overview', analyticsController.getOverview);

router.post('/createUser', adminController.createUser);
router.post('/getUser', adminController.getUser);
router.put('/addBalance', adminController.addBalance);
router.post('/changeUserPassword', adminController.changeUserPassword);

// Services by admin
router.post('/createService', adminController.createService);
router.put('/updateService', adminController.updateService);
router.post('/addService', adminController.addService);
router.post('/deleteService', adminController.removeService);
router.get('/getCustomServices', adminController.getCustomServices);
router.post('/deleteCustomServices', adminController.deleteService);
router.get('/getServices', adminController.getServices);
router.get('/pricingSettings', pricingController.getSettings);
router.put('/pricingSettings', pricingController.updateSettings);
router.post('/pricingSettings/preview', pricingController.preview);
router.get('/pricingSettings/history', pricingController.getHistory);
router.get('/catalogueServices', catalogueController.getCatalogueServices);
router.put('/catalogueServices/:serviceId', catalogueController.updateCatalogueService);
router.get('/providers', catalogueController.getProviders);
router.post('/providers', catalogueController.createProvider);
router.patch('/providers/:providerId', catalogueController.updateProvider);
router.get('/providerOffers', catalogueController.getProviderOffers);
router.post('/providerSync/report', catalogueController.createSyncReport);
router.get('/providerSync/runs', catalogueController.getSyncRuns);
router.get('/providerSync/runs/:runId', catalogueController.getSyncRun);
router.post('/providerSync/runs/:runId/apply', catalogueController.applySyncRun);
router.get('/operations/jobDispatches', operationsController.getJobDispatches);
router.get('/operations/reconciliationOrders', operationsController.getReconciliationOrders);
router.post('/operations/reconciliationOrders/:orderId/resolve', operationsController.resolveReconciliationOrder);
router.get('/payments', paymentController.listAdmin);
router.post('/payments/:paymentId/reconcile', paymentController.reconcileAdmin);
router.get('/refills', refillController.listAdmin);
router.post('/refills/:refillRequestId/poll', refillController.pollAdmin);
router.get('/tickets', ticketController.listAdmin);
router.get('/tickets/:publicTicketId', ticketController.getAdmin);
router.post('/tickets/:publicTicketId/messages', ticketController.addAdminMessage);
router.patch('/tickets/:publicTicketId', ticketController.updateAdmin);

router.get('/manualTasks', manualTaskController.listTasks);
router.post('/manualTasks/:taskId/assign', manualTaskController.assignTask);
router.put('/manualTasks/:taskId', manualTaskController.updateTask);

module.exports = router;
