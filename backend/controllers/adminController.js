const bcrypt = require('bcrypt');
const Transaction = require('../models/Transaction');
const Service = require('../models/Service');
const Order = require('../models/Order');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const Provider = require('../models/Provider');
require('dotenv').config();
const { buildUserIdQuery, normalizeUserId } = require('../utils/userId');
const { adminAdjustWallet } = require('../services/walletService');
const { getPricingSettings, validateMarkupBps } = require('../services/pricingService');
const { getProviderAdapterForProvider } = require('../providers/providerRegistry');

class AdminController {

    async createUser(req, res) {
        const { userId, password, role, services } = req.payload;

        const normalizedUserId = normalizeUserId(userId);

        if (!normalizedUserId || !password || !role) {
            return res.status(400).json({ error: 'userid, password, and role are required' });
        }
        if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'role must be user or admin' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({
                userId: normalizeUserId(userId),
                password: hashedPassword,
                role,
                services,
                money: 0,
                walletBalanceMinor: 0,
            });

            await newUser.save();

            res.status(200).json({ userId: normalizedUserId, role });
        } catch (err) {
            console.log(err)
            res.status(500).json({ error: 'Error creating user' });
        }
    }

    async addBalance(req, res) {
        const { userId, amountMinor, direction, reason } = req.payload;
        const clientIdempotencyKey = req.get('Idempotency-Key');

        try {
            if (typeof clientIdempotencyKey !== 'string' || !clientIdempotencyKey.trim()) {
                return res.status(400).json({
                    msg: 'Wallet adjustment failed',
                    error: 'Idempotency-Key header is required',
                    code: 'IDEMPOTENCY_KEY_REQUIRED',
                });
            }
            if (clientIdempotencyKey.length > 200) {
                return res.status(400).json({
                    msg: 'Wallet adjustment failed',
                    error: 'Idempotency-Key header is too long',
                    code: 'INVALID_IDEMPOTENCY_KEY',
                });
            }

            const userIdQuery = buildUserIdQuery(userId);
            if (!userIdQuery) {
                return res.status(400).json({ msg: "User ID is required" });
            }

            const curr = await User.findOne(userIdQuery);
            if (!curr) {
                return res.status(404).json({ msg: "User not found" });
            }

            const idempotencyKey = `admin-adjustment:${req.currentUser._id}:${clientIdempotencyKey.trim()}`;

            const result = await adminAdjustWallet({
                userId: curr._id,
                direction,
                amountMinor,
                sourceType: 'ADMIN_ADJUSTMENT',
                sourceId: idempotencyKey,
                idempotencyKey,
                actorType: 'ADMIN',
                actorId: req.currentUser._id,
                description: reason,
            });

            res.status(200).json({
                data: {
                    userId: curr.userId,
                    direction: result.ledger.direction,
                    amountMinor: result.ledger.amountMinor,
                    balanceAfterMinor: result.ledger.balanceAfterMinor,
                    idempotentReplay: !result.created,
                }
            });
        } catch (error) {
            console.log(error);
            res.status(error.statusCode || 500).json({
                msg: "Wallet adjustment failed",
                error: error.message,
                code: error.code || 'WALLET_ADJUSTMENT_FAILED',
            });
        }
    }

    async addService(req, res) {
        const { userId, serviceId } = req.payload;


        if (!userId || !serviceId) {
            return res.status(400).json({ message: 'userId and serviceId are required.' });
        }

        try {
            const user = await User.findOne(buildUserIdQuery(userId));
            if (!user) {
                return res.status(404).json({ message: 'Invalid user.' });
            }

            if (!user.services.includes(serviceId)) {
                user.services.push(serviceId);
                await user.save();
                res.status(200).json({ message: 'Service added successfully.', user });
            } else {
                res.status(200).json({ message: 'Service already exists for user.', user });
            }
        } catch {
            res.status(500).json({ message: 'Database error.' });
        }
    }

    async removeService(req, res) {
        const { userId, serviceId } = req.payload;


        if (!userId || !serviceId) {
            return res.status(400).json({ message: 'userId and serviceId are required.' });
        }

        try {
            const user = await User.findOne(buildUserIdQuery(userId));
            if (user) {
                user.services.pull(serviceId);
                await user.save();
            }

            if (!user) {
                return res.status(404).json({ message: 'User not found.' });
            }

            res.status(200).json({ message: 'Service deleted from user.', user });
        } catch (error) {
            res.status(500).json({ message: 'Server error.', error: error.message });
        }
    }


    async changeUserPassword(req, res) {
        try {
            const { userId, newPassword } = req.body;



            if (!userId || !newPassword) {
                return res.status(400).json({ message: 'userId and password are required' });
            }


            const hashedPassword = await bcrypt.hash(newPassword, 10);


            const user = await User.findOneAndUpdate(
                buildUserIdQuery(userId),
                { password: hashedPassword },
                { new: true }
            );

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }



            res.status(200).json({ userId, message: 'Password changed successfully' });
        } catch (err) {
            console.log(err);
            res.status(500).json({ message: 'Server error' });
        }
    }

    async getUser(req, res) {
        try {
            const { userId } = req.payload;
            const userIdQuery = buildUserIdQuery(userId);

            if (!userIdQuery) {
                return res.status(400).json({ message: 'User ID is required' });
            }

            const user = await User.findOne(userIdQuery);

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const orders = await Order
                .find({ user: user._id })
                .sort({ createdAt: -1 })
                .limit(10);

            const transactions = await Transaction
                .find({ user: user._id })
                .sort({ date: -1 })
                .limit(10);

            const walletLedger = await WalletLedger
                .find({ userId: user._id })
                .sort({ createdAt: -1 })
                .limit(10);


            const services = await Service.find({
                serviceId: { $in: user.services || [] }
            });

            const balanceMinor = Number.isSafeInteger(user.walletBalanceMinor)
                ? user.walletBalanceMinor
                : Math.round((Number(user.money) + Number.EPSILON) * 100);
            res.status(200).json({
                userId,
                balance: balanceMinor / 100,
                balanceMinor,
                orders,
                transactions,
                walletLedger,
                services
            });
        } catch {
            res.status(500).json({ message: 'Server error' });
        }
    }

    async createService(req, res) {

        try {
            const { serviceId, service, name, internalName, rate, min, max, refill, markupOverrideBps } = req.body;
            if (markupOverrideBps !== undefined && markupOverrideBps !== null) {
                validateMarkupBps(markupOverrideBps);
                const settings = await getPricingSettings();
                if (markupOverrideBps < settings.minimumMarginBps) {
                    const error = new Error('Service markup override is below the minimum margin');
                    error.statusCode = 400;
                    error.code = 'MARKUP_BELOW_MINIMUM';
                    throw error;
                }
            }
            const serv = new Service({
                serviceId,
                service,
                name,
                internalName,
                rate,
                min,
                max,
                refill,
                markupOverrideBps: markupOverrideBps ?? null,
            });
            await serv.save();
            return res.status(200).json({ message: "new Service created", data: { service, serviceId, name, rate, min, max } });
        } catch (error) {
            console.log(error);
            return res.status(error.statusCode || 500).json({
                error: 'Failed to create service',
                details: error.message,
                code: error.code || 'SERVICE_CREATE_FAILED',
            });
        }

    }

    async deleteService(req, res) {
        const { serviceId } = req.payload;
        try {

            const deletedService = await Service.findOneAndDelete({ serviceId });


            if (deletedService) {
                await User.updateMany(
                    { services: { $in: [serviceId] } },
                    { $pull: { services: serviceId } }
                );
            }
            if (!deletedService) {
                return res.status(404).json({ message: 'Service not found' });
            }
            res.json({ message: 'Service deleted successfully' });
        } catch (error) {
            res.status(500).json({ message: 'Error deleting service', error: error.message });
        }
    }

    async updateService(req, res) {
        try {
            const { serviceId, min, max, rate, refill, markupOverrideBps } = req.payload;

            // Find service by ID and update
            const updateData = { min, max, rate, refill };
            if (markupOverrideBps !== undefined) {
                if (markupOverrideBps !== null) {
                    validateMarkupBps(markupOverrideBps);
                    const settings = await getPricingSettings();
                    if (markupOverrideBps < settings.minimumMarginBps) {
                        const error = new Error('Service markup override is below the minimum margin');
                        error.statusCode = 400;
                        error.code = 'MARKUP_BELOW_MINIMUM';
                        throw error;
                    }
                }
                updateData.markupOverrideBps = markupOverrideBps;
            }
            const updatedService = await Service.findOneAndUpdate(
                { serviceId },
                updateData,
                { new: true, runValidators: true }
            );

            if (!updatedService) {
                return res.status(404).json({ message: 'Service not found' });
            }


            res.json({ message: 'Service updated successfully', service: updatedService });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                message: 'Error updating service',
                error: error.message,
                code: error.code || 'SERVICE_UPDATE_FAILED',
            });
        }
    }

    async getCustomServices(req, res) {
        try {
            const services = await Service.find({});
            res.status(200).json({ data: services });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Server Error', error: error.message });
        }
    }

    async getServices(req, res) {
        try {
            let query = req.query.providerId
                ? Provider.findById(req.query.providerId)
                : Provider.findOne({ enabled: true }).sort({ priority: 1, name: 1 });
            query = query.select('+credentialReference');
            const provider = await query;
            if (!provider) return res.status(404).json({ msg: 'Provider not found' });
            const normalizedServices = await getProviderAdapterForProvider(provider).getServices();
            const services = normalizedServices.map(({ raw }) => ({
                ...raw,
                service: String(raw.service),
            }));

            res.status(200).json({ data: services });
        } catch (error) {
            console.error('Provider service catalogue failed:', error.message);
            res.status(502).json({ msg: 'Provider service catalogue is temporarily unavailable' });
        }
    }

}

module.exports = new AdminController();
