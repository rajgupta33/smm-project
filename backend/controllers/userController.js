require('dotenv').config();
const { createHash } = require('crypto');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WalletLedger = require('../models/WalletLedger');
const Service = require('../models/Service');
const ManualTask = require('../models/ManualTask');
const RefillRequest = require('../models/RefillRequest');
const Provider = require('../models/Provider');
const User = require('../models/User');
const mongoose = require('mongoose');
const { connectToDatabase } = require('../utils/serverlessDb');
const bcrypt = require('bcrypt');
const { buildUserIdQuery } = require('../utils/userId');
const { validateOrderRequest } = require('../services/orderValidationService');
const { appendOrderEvent } = require('../services/orderEventService');
const { debitWallet } = require('../services/walletService');
const {
    getPricingSettings,
    toCustomerService,
} = require('../services/pricingService');
const {
    getCurrentProviderAdapter,
    getProviderAdapterForProvider,
} = require('../providers/providerRegistry');
const {
    createDispatch,
    dispatchByJobKey,
    orderDispatchDocument,
} = require('../services/jobDispatchService');
const { createDripFeedSchedule } = require('../services/dripFeedService');
const {
    resolveOrderPricing,
    toCustomerQuote,
} = require('../services/orderPricingResolver');
const { getRuntimeConfig } = require('../config/runtimeConfig');

function assertMatchingOrderReplay(existingOrder, validatedRequest) {
    if (
        existingOrder.service !== validatedRequest.serviceId ||
        existingOrder.quantity !== validatedRequest.totalQuantity ||
        (existingOrder.target && existingOrder.target !== validatedRequest.target)
    ) {
        const error = new Error('Idempotency key is already used for a different order');
        error.statusCode = 409;
        error.code = 'IDEMPOTENCY_CONFLICT';
        throw error;
    }
}

class UserController {

    async changePassword(req, res) {
        
        try {
            const { currentPassword, newPassword } = req.body;
            const userId = req.user.id;

            if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
                return res.status(400).json({ msg: 'Current password and a new password of at least 8 characters are required' });
            }

            const userRecord = await User.findOne(buildUserIdQuery(userId));
            if (!userRecord) {
                return res.status(404).json({ msg: "User not found" });
            }

            const isMatch = await bcrypt.compare(currentPassword, userRecord.password);
            if (!isMatch) {
                return res.status(400).json({ msg: "Current password is incorrect" });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await User.updateOne(
                { _id: userRecord._id },
                { $set: { password: hashedPassword } }
            );

            res.status(200).json({ message: 'Password changed successfully' });
        } catch (error) {
            console.error('Error changing password:', error);
            res.status(500).json({ msg: "Internal server error" });
        }
    }

    /**
     * Returns the authoritative price for a prospective order.
     *
     * Read-only: no wallet mutation, no order record, no provider call. A quote is
     * not authorization -- placeOrder recalculates from the same resolver inside
     * its own transaction before debiting.
     */
    async quoteOrder(req, res) {
        try {
            const validatedRequest = validateOrderRequest(req.body);
            const user = await User.findOne(buildUserIdQuery(req.user.id));
            if (!user) {
                return res.status(401).json({ success: false, message: 'Authenticated user not found' });
            }
            const { pricingSnapshot } = await resolveOrderPricing({ validatedRequest, user });
            return res.status(200).json({
                success: true,
                data: toCustomerQuote(pricingSnapshot, validatedRequest),
            });
        } catch (error) {
            const status = error.statusCode || 400;
            return res.status(status).json({
                success: false,
                message: error.message || 'Unable to price this order',
                code: error.code || 'QUOTE_FAILED',
            });
        }
    }

    async getUserService(req, res) {
        try {
            const user = await User.findOne(buildUserIdQuery(req.user.id));

            const userServiceIds = user?.services || [];

            const filteredServices = await Service.find({
                serviceId: { $in: userServiceIds }
            }).select('-service -internalName').lean();
            const settings = await getPricingSettings();
            const customerServices = filteredServices.map(
                (service) => toCustomerService(service, settings)
            );

            res.status(200).json({ data: customerServices });

        } catch (error) {
            console.error('Error fetching user services:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    async getTransactions(req, res) {
        try {
            const userId = req.user.id;

            const requestedPage = parseInt(req.query.page || req.query['page[page]'] || '1');
            const requestedLimit = parseInt(req.query.limit || req.query['page[limit]'] || '10');
            const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
            const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
                ? Math.min(100, requestedLimit)
                : 10;
            const skip = (page - 1) * limit;

            const user = await User.findOne(buildUserIdQuery(userId));

            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const userObjectId = user._id;

            const [legacyTransactions, ledgerEntries] = await Promise.all([
                Transaction.find({ user: userObjectId })
                    .sort({ date: -1 })
                    .limit(skip + limit),
                WalletLedger.find({ userId: userObjectId })
                    .sort({ createdAt: -1 })
                    .limit(skip + limit),
            ]);

            const payments = [
                ...legacyTransactions.map((transaction) => ({
                    _id: transaction._id,
                    amount: transaction.amount,
                    amountMinor: Math.round((transaction.amount + Number.EPSILON) * 100),
                    orderId: transaction.orderId,
                    date: transaction.date,
                    status: 'LEGACY_RECORDED',
                    type: 'LEGACY_TRANSACTION',
                })),
                ...ledgerEntries.map((entry) => ({
                    _id: entry._id,
                    amount: (entry.direction === 'DEBIT' ? -1 : 1) * entry.amountMinor / 100,
                    amountMinor: (entry.direction === 'DEBIT' ? -1 : 1) * entry.amountMinor,
                    orderId: entry.sourceId,
                    date: entry.createdAt,
                    status: 'RECORDED',
                    type: entry.type,
                    direction: entry.direction,
                    balanceAfterMinor: entry.balanceAfterMinor,
                })),
            ]
                .sort((left, right) => new Date(right.date) - new Date(left.date))
                .slice(skip, skip + limit);

            res.status(200).json({ success: true, data: payments });

        } catch (error) {
            console.error('Error fetching payments:', error);
            res.status(500).json({ success: false, message: 'Server error: An error occurred while fetching payments' });
        }
    }

    async placeOrder(req, res) {
        let session;
        let validatedRequest;

        try {
            validatedRequest = validateOrderRequest(req.body);
            const clientIdempotencyKey = req.get('Idempotency-Key');
            if (typeof clientIdempotencyKey !== 'string' || !clientIdempotencyKey.trim()) {
                const error = new Error('Idempotency-Key header is required');
                error.statusCode = 400;
                error.code = 'IDEMPOTENCY_KEY_REQUIRED';
                throw error;
            }
            if (clientIdempotencyKey.length > 200) {
                const error = new Error('Idempotency-Key header is too long');
                error.statusCode = 400;
                error.code = 'INVALID_IDEMPOTENCY_KEY';
                throw error;
            }

            const orderIdempotencyKey = `order:${req.user.databaseId}:${clientIdempotencyKey.trim()}`;
            const existingOrder = await Order.findOne({
                idempotencyKey: orderIdempotencyKey,
                user: req.user.databaseId,
            });
            if (existingOrder) {
                assertMatchingOrderReplay(existingOrder, validatedRequest);
                if (existingOrder.lifecycleStatus === 'INTENT_COMMITTED') {
                    const jobKey = orderDispatchDocument(existingOrder._id).jobKey;
                    await dispatchByJobKey(jobKey).catch(() => {});
                }
                const responseStatus = ['INTENT_COMMITTED', 'SUBMITTING', 'RECONCILIATION_REQUIRED']
                    .includes(existingOrder.lifecycleStatus) ? 202 : 200;
                return res.status(responseStatus).json({
                    msg: 'Order request already recorded; it will not be submitted again',
                    orderId: existingOrder.orderId,
                    status: existingOrder.lastStatus,
                    lifecycleStatus: existingOrder.lifecycleStatus,
                    fundingStatus: existingOrder.fundingStatus,
                    code: existingOrder.lifecycleStatus === 'RECONCILIATION_REQUIRED'
                        ? 'RECONCILIATION_REQUIRED'
                        : existingOrder.lifecycleStatus === 'PROVIDER_REJECTED'
                            ? 'PROVIDER_REJECTED'
                            : 'ORDER_ALREADY_RECORDED',
                    chargedAmountMinor: existingOrder.pricingSnapshot?.sellingTotalMinor,
                    currency: existingOrder.pricingSnapshot?.currency || 'INR',
                    idempotentReplay: true,
                });
            }

            await connectToDatabase();
            session = await mongoose.startSession();
            const localOrderId = `ord_${createHash('sha256').update(orderIdempotencyKey).digest('hex').slice(0, 32)}`;
            let orderIntent;
            let createdIntent = false;
            let dripDispatchJobKey = null;
            await session.withTransaction(async () => {
                const freshUser = await User.findOne(buildUserIdQuery(req.user.id)).session(session);
                if (!freshUser) {
                    const error = new Error('User not found');
                    error.statusCode = 401;
                    throw error;
                }

                // Shared with the customer quote endpoint so the price shown before
                // paying is produced by the same code path that charges.
                const {
                    selectedService,
                    isManual,
                    isDripFeed,
                    providerOffer,
                    providerServiceId,
                    pricingSnapshot,
                } = await resolveOrderPricing({
                    validatedRequest,
                    user: freshUser,
                    session,
                });

                const walletResult = await debitWallet({
                    userId: freshUser._id,
                    amountMinor: pricingSnapshot.sellingTotalMinor,
                    type: 'ORDER',
                    sourceType: 'ORDER',
                    sourceId: localOrderId,
                    idempotencyKey: orderIdempotencyKey,
                    actorType: 'USER',
                    actorId: freshUser._id,
                    description: `Order for service ${selectedService.serviceId}`,
                    session,
                });
                if (!walletResult.created) {
                    const replayedOrder = await Order.findOne({
                        idempotencyKey: orderIdempotencyKey,
                        user: freshUser._id,
                    }).session(session);
                    if (replayedOrder) {
                        assertMatchingOrderReplay(replayedOrder, validatedRequest);
                        orderIntent = replayedOrder;
                        return;
                    }

                    const error = new Error('An order with this idempotency key is already being processed');
                    error.statusCode = 409;
                    error.code = 'ORDER_IN_PROGRESS';
                    throw error;
                }

                const newOrder = new Order({
                    localOrderId,
                    idempotencyKey: orderIdempotencyKey,
                    orderId: localOrderId,
                    lastStatus: isManual ? 'Pending Manual Fulfilment' : isDripFeed ? 'Drip-feed scheduled' : 'Submission pending',
                    lifecycleStatus: isManual ? 'MANUAL_PROCESSING' : isDripFeed ? 'DRIP_FEED' : 'INTENT_COMMITTED',
                    fundingStatus: 'DEBITED',
                    quantity: validatedRequest.totalQuantity,
                    rate: pricingSnapshot.sellingRateMinor / 100,
                    pricingSnapshot,
                    service: selectedService.serviceId,
                    providerServiceId,
                    providerId: providerOffer?.providerId || null,
                    providerOfferId: providerOffer?._id || null,
                    catalogueServiceId: selectedService.catalogueServiceId || providerOffer?.catalogueServiceId || null,
                    refillGuaranteeUntil: selectedService.refill
                        ? new Date(Date.now() + getRuntimeConfig().refill.defaultGuaranteeDays * 86400000)
                        : null,
                    target: validatedRequest.target,
                    user: freshUser._id,
                    refill: selectedService.refill ? '' : null
                });
                await newOrder.save({ session });
                await appendOrderEvent({
                    orderId: newOrder._id,
                    userId: freshUser._id,
                    eventType: 'ORDER_CREATED',
                    metadata: {
                        quantity: validatedRequest.totalQuantity,
                        rate: newOrder.rate,
                        runs: validatedRequest.runs,
                        interval: validatedRequest.interval,
                    },
                    session
                });
                await appendOrderEvent({
                    orderId: newOrder._id,
                    userId: freshUser._id,
                    eventType: 'PRICE_CALCULATED',
                    internalOnly: true,
                    metadata: pricingSnapshot,
                    session
                });
                await appendOrderEvent({
                    orderId: newOrder._id,
                    userId: freshUser._id,
                    eventType: 'FUNDS_RESERVED',
                    internalOnly: true,
                    metadata: { amountMinor: pricingSnapshot.sellingTotalMinor },
                    session
                });
                if (isDripFeed) {
                    const schedule = await createDripFeedSchedule({
                        order: newOrder,
                        quantityPerRun: validatedRequest.quantity,
                        totalRuns: validatedRequest.runs,
                        intervalMinutes: validatedRequest.interval,
                        session,
                    });
                    dripDispatchJobKey = schedule.dispatchDocument.jobKey;
                } else if (isManual) {
                    const task = new ManualTask({
                        orderId: newOrder._id,
                        status: 'PENDING'
                    });
                    await task.save({ session });
                } else {
                    await createDispatch(orderDispatchDocument(newOrder._id), session);
                }
                orderIntent = newOrder;
                createdIntent = true;
            });

            await session.endSession();
            session = null;

            if (!createdIntent) {
                return res.status(202).json({
                    msg: 'Order request already recorded; it will not be submitted again',
                    orderId: orderIntent?.orderId,
                    status: orderIntent?.lastStatus || 'Processing',
                    lifecycleStatus: orderIntent?.lifecycleStatus,
                    code: orderIntent?.lifecycleStatus === 'RECONCILIATION_REQUIRED'
                        ? 'RECONCILIATION_REQUIRED'
                        : 'ORDER_ALREADY_RECORDED',
                    idempotentReplay: true,
                });
            }

            if (orderIntent.lifecycleStatus === 'MANUAL_PROCESSING') {
                return res.status(202).json({
                    msg: 'Order recorded for manual fulfilment',
                    code: 'MANUAL_ORDER_ACCEPTED',
                    orderId: orderIntent.orderId,
                    status: orderIntent.lastStatus,
                    lifecycleStatus: orderIntent.lifecycleStatus,
                    fundingStatus: orderIntent.fundingStatus,
                    chargedAmountMinor: orderIntent.pricingSnapshot?.sellingTotalMinor,
                    currency: orderIntent.pricingSnapshot?.currency || 'INR',
                });
            }

            if (orderIntent.lifecycleStatus === 'DRIP_FEED') {
                const dispatch = await dispatchByJobKey(dripDispatchJobKey).catch(() => ({ dispatched: false }));
                return res.status(202).json({
                    msg: 'Drip-feed order recorded and its first run was queued',
                    code: 'DRIP_FEED_ORDER_ACCEPTED',
                    orderId: orderIntent.orderId,
                    status: orderIntent.lastStatus,
                    lifecycleStatus: orderIntent.lifecycleStatus,
                    fundingStatus: orderIntent.fundingStatus,
                    runs: validatedRequest.runs,
                    intervalMinutes: validatedRequest.interval,
                    chargedAmountMinor: orderIntent.pricingSnapshot?.sellingTotalMinor,
                    currency: orderIntent.pricingSnapshot?.currency || 'INR',
                    queueDispatchPending: dispatch.dispatchStatus !== 'ENQUEUED',
                });
            }

            const dispatch = await dispatchByJobKey(
                orderDispatchDocument(orderIntent._id).jobKey
            ).catch(() => ({ dispatched: false }));
            res.status(202).json({
                msg: 'Order recorded and queued for provider submission',
                code: 'ORDER_QUEUED',
                orderId: orderIntent.orderId,
                status: orderIntent.lastStatus,
                lifecycleStatus: orderIntent.lifecycleStatus,
                fundingStatus: orderIntent.fundingStatus,
                chargedAmountMinor: orderIntent.pricingSnapshot?.sellingTotalMinor,
                currency: orderIntent.pricingSnapshot?.currency || 'INR',
                queueDispatchPending: dispatch.dispatchStatus !== 'ENQUEUED',
            });
        } catch (error) {
            if (error?.code === 11000) {
                const replayedOrder = await Order.findOne({
                    idempotencyKey: `order:${req.user.databaseId}:${req.get('Idempotency-Key')?.trim()}`,
                    user: req.user.databaseId,
                });
                if (replayedOrder) {
                    try {
                        assertMatchingOrderReplay(replayedOrder, validatedRequest);
                    } catch (replayError) {
                        return res.status(replayError.statusCode).json({
                            msg: 'Failed to place order',
                            error: replayError.message,
                            code: replayError.code,
                        });
                    }
                    return res.status(202).json({
                        msg: 'Order request already recorded; it will not be submitted again',
                        orderId: replayedOrder.orderId,
                        status: replayedOrder.lastStatus,
                        lifecycleStatus: replayedOrder.lifecycleStatus,
                        code: replayedOrder.lifecycleStatus === 'RECONCILIATION_REQUIRED'
                            ? 'RECONCILIATION_REQUIRED'
                            : 'ORDER_ALREADY_RECORDED',
                        idempotentReplay: true,
                    });
                }
            }
            console.error('Error placing order:', error);
            res.status(error.statusCode || 500).json({
                msg: 'Failed to place order',
                error: error.statusCode ? error.message : 'Order request could not be completed',
                code: error.code || 'ORDER_FAILED',
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }

    async getOrderTimeline(req, res) {
        try {
            const userId = req.user.databaseId;
            const orderId = req.params.orderId;
            const OrderEvent = require('../models/OrderEvent');

            const order = await Order.findOne({ orderId, user: userId })
                .select('localOrderId orderId lastStatus lifecycleStatus fundingStatus quantity service pricingSnapshot.sellingTotalMinor pricingSnapshot.currency createdAt')
                .lean();
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const events = await OrderEvent.find({ orderId: order._id, internalOnly: false })
                .select('eventType metadata createdAt')
                .sort({ createdAt: 1 })
                .lean();

            res.json({ order, events });
        } catch (error) {
            console.error('Error getting order timeline:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getOrders(req, res) {
        try {
            const userId = req.user.id;

            const page = parseInt(req.query['page[page]'] || '1');
            const limit = parseInt(req.query['page[limit]'] || '10');
            const skip = (page - 1) * limit;

            const user = await User.findOne(buildUserIdQuery(userId));

            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const userObjectId = user._id;

            const orders = await Order
                                   .find({ user: userObjectId })
                                   .select('-providerOrderId -providerServiceId -providerId -providerOfferId -target -submissionAttempt.responseSnapshot -submissionAttempt.errorMessage -reconciliationReason -pricingSnapshot.providerCostRateMinor -pricingSnapshot.providerCostTotalMinor -pricingSnapshot.grossSpreadMinor -pricingSnapshot.markupBps')
                                   .sort({ createdAt: -1 })
                                   .skip(skip)
                                   .limit(limit)
                                   .lean();

            const refillRequests = await RefillRequest.find({
                orderId: { $in: orders.map((order) => order._id) },
            }).sort({ requestedAt: -1 }).lean();
            const latestRefillByOrder = new Map();
            for (const refillRequest of refillRequests) {
                const key = String(refillRequest.orderId);
                if (!latestRefillByOrder.has(key)) {
                    latestRefillByOrder.set(key, {
                        id: String(refillRequest._id), status: refillRequest.status,
                        requestedAt: refillRequest.requestedAt, expiresAt: refillRequest.expiresAt,
                    });
                }
            }
            const customerOrders = orders.map((order) => ({
                ...order, refillRequest: latestRefillByOrder.get(String(order._id)) || null,
            }));

            res.status(200).json({ success: true, data: customerOrders });

        } catch (error) {
            console.error('Error fetching orders:', error);
            res.status(500).json({ success: false, message: 'Server error: An error occurred while fetching orders' });
        }
    }

    async getOrderStatus(req, res) {
        const { order } = req.body;
        if (!order) {
            return res.status(400).json({ error: 'Order ID is required' });
        }

        try {
            const user = await User.findOne(buildUserIdQuery(req.user.id));
            if (!user) {
                return res.status(401).json({ error: 'Authenticated user not found' });
            }

            const ownedOrder = await Order.findOne({ orderId: order, user: user._id });
            if (!ownedOrder) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const providerOrderId = ownedOrder.providerOrderId ||
                (ownedOrder.localOrderId ? null : ownedOrder.orderId);
            if (!providerOrderId) {
                return res.status(409).json({
                    error: 'Order has no confirmed provider identifier',
                    code: ownedOrder.lifecycleStatus || 'ORDER_NOT_SUBMITTED',
                });
            }

            let adapter = getCurrentProviderAdapter();
            if (ownedOrder.providerId) {
                const provider = await Provider.findById(ownedOrder.providerId)
                    .select('+credentialReference');
                adapter = getProviderAdapterForProvider(provider);
            }
            const providerStatus = await adapter.getOrderStatus(providerOrderId);

            const updatedOrder = await Order.findOneAndUpdate(
                { orderId: ownedOrder.orderId, user: user._id },
                {
                    $set: {
                        lastStatus: providerStatus.status || ownedOrder.lastStatus,
                        start_count: providerStatus.start_count
                    }
                },
                { new: true }
            );

            providerStatus.charge = updatedOrder
                ? (updatedOrder.pricingSnapshot?.sellingTotalMinor
                    ?? Math.ceil(updatedOrder.quantity * updatedOrder.rate * 100 / 1000)) / 100
                : 0;

            res.status(200).json(providerStatus);
        } catch (error) {
            console.error('Error fetching order status:', error);
            res.status(502).json({ error: 'Provider status is temporarily unavailable' });
        }
    }

}

module.exports = new UserController();
