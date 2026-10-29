const { randomUUID } = require('crypto');
const {
    acknowledgeAlert,
    listAlerts,
    resolveAlertByAdmin,
    summarizeActiveAlerts,
} = require('../services/adminAlertService');
const { scanProviderBalances } = require('../services/providerBalanceService');
const { scanServiceAvailability } = require('../services/serviceAvailabilityService');

function requestIdFor(req) {
    return req.get('X-Request-Id')?.slice(0, 200) || randomUUID();
}

function sendError(res, error, fallbackCode, fallbackMessage) {
    return res.status(error.statusCode || 500).json({
        success: false,
        error: {
            code: error.statusCode ? error.code : fallbackCode,
            message: error.statusCode ? error.message : fallbackMessage,
        },
    });
}

class AlertController {
    async list(req, res) {
        try {
            const data = await listAlerts({ view: req.query.view || 'active', limit: req.query.limit });
            return res.json({ success: true, data });
        } catch (error) {
            return sendError(res, error, 'ALERT_READ_FAILED', 'Alerts could not be loaded');
        }
    }

    async summary(req, res) {
        void req;
        try {
            return res.json({ success: true, data: await summarizeActiveAlerts() });
        } catch (error) {
            return sendError(res, error, 'ALERT_READ_FAILED', 'Alert summary could not be loaded');
        }
    }

    async acknowledge(req, res) {
        try {
            const result = await acknowledgeAlert({
                alertId: req.params.alertId,
                actorId: req.currentUser._id,
                requestId: requestIdFor(req),
            });
            return res.json({ success: true, changed: result.changed, data: result.alert });
        } catch (error) {
            return sendError(res, error, 'ALERT_UPDATE_FAILED', 'Alert could not be acknowledged');
        }
    }

    async resolve(req, res) {
        try {
            const result = await resolveAlertByAdmin({
                alertId: req.params.alertId,
                actorId: req.currentUser._id,
                requestId: requestIdFor(req),
            });
            return res.json({ success: true, changed: result.changed, data: result.alert });
        } catch (error) {
            return sendError(res, error, 'ALERT_UPDATE_FAILED', 'Alert could not be resolved');
        }
    }

    async checkProviderBalances(req, res) {
        void req;
        try {
            return res.json({ success: true, data: await scanProviderBalances() });
        } catch (error) {
            return sendError(res, error, 'BALANCE_CHECK_FAILED', 'Provider balances could not be checked');
        }
    }

    async checkServiceAvailability(req, res) {
        void req;
        try {
            return res.json({ success: true, data: await scanServiceAvailability() });
        } catch (error) {
            return sendError(res, error, 'AVAILABILITY_CHECK_FAILED', 'Service availability could not be checked');
        }
    }
}

module.exports = new AlertController();
