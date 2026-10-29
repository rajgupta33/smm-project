const express = require('express');
const router = express.Router();
const resellerController = require('../controllers/resellerController');

// Mounted behind authenticate + requireReseller + CSRF in index.js, so every
// handler already has a database-loaded profile on req.resellerProfile.
router.get('/dashboard', resellerController.getDashboard);
router.get('/commissions', resellerController.listCommissions);
router.get('/customers', resellerController.listCustomers);

// WhatsApp marketing. Campaign content is assigned by an admin; a reseller can
// only draw the next number from what they have been given.
router.get('/marketing', resellerController.getMarketingStatus);
router.post('/marketing/leads/claim', resellerController.claimLead);
router.post('/marketing/leads/:leadId/sent', resellerController.markSent);
router.post('/marketing/leads/:leadId/release', resellerController.releaseLead);
router.post('/marketing/leads/:leadId/optOut', resellerController.optOutLead);

module.exports = router;
