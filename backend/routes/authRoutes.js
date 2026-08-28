const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middelwares/auth');
const { csrfProtection, issueCsrfToken } = require('../middelwares/csrf');

router.get('/csrf', issueCsrfToken);
router.post('/login', csrfProtection, authController.login);
router.get('/me', authenticate, authController.getMe);
router.post('/logout', csrfProtection, authController.logout);

module.exports = router;
