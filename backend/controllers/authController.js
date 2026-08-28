const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { buildUserIdQuery } = require('../utils/userId');
const { getJwtSecret } = require('../middelwares/auth');
const { CSRF_COOKIE, csrfCookieOptions } = require('../middelwares/csrf');
const {
    auditLogin,
    checkLoginLimit,
    clearLoginFailures,
    recordLoginFailure,
} = require('../services/loginSecurityService');
require('dotenv').config();

class AuthController {

    async login(req, res) {
        const JWT_SECRET = getJwtSecret();
        const COOKIE_NAME = 'auth_token';

        const { userId, password } = req.body;
        const userIdQuery = buildUserIdQuery(userId);

        if (!userIdQuery || !password) {
            return res.status(400).json({ message: 'User ID and password required.' });
        }

        const limit = await checkLoginLimit(req, userId);
        if (!limit.allowed) {
            await auditLogin(req, 'AUTH_LOGIN_RATE_LIMITED', userId);
            res.set('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
            return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
        }

        try {
            const user = await User.findOne(userIdQuery);

            if (!user) {
                await recordLoginFailure(limit.key);
                await auditLogin(req, 'AUTH_LOGIN_FAILED', userId);
                return res.status(401).json({ message: 'Invalid credentials.' });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                await recordLoginFailure(limit.key);
                await auditLogin(req, 'AUTH_LOGIN_FAILED', userId, user._id);
                return res.status(401).json({ message: 'Invalid credentials.' });
            }

            await clearLoginFailures(limit.key);

            const tokenPayload = { sub: String(user._id), id: user.userId };
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });

            const cookieConfig = req.app.locals.runtimeConfig.cookie;
            res.cookie(COOKIE_NAME, token, {
                httpOnly: true,
                secure: cookieConfig.secure,
                sameSite: cookieConfig.sameSite,
                domain: cookieConfig.domain,
                path: '/',
                maxAge: 60 * 60 * 1000
            });
            await auditLogin(req, 'AUTH_LOGIN_SUCCEEDED', user.userId, user._id);

            const walletBalanceMinor = Number.isSafeInteger(user.walletBalanceMinor)
                ? user.walletBalanceMinor
                : Math.round((Number(user.money) + Number.EPSILON) * 100);
            res.status(200).json({
                userId: user.userId,
                role: user.role,
                money: walletBalanceMinor / 100,
                walletBalanceMinor,
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ message: 'Server error.' });
        }
    }

    async getMe(req, res) {
        try {
            const userIdQuery = buildUserIdQuery(req.user.id);
            if (!userIdQuery) {
                return res.status(401).json({ error: 'Invalid auth token' });
            }

            const user = await User.findOne(userIdQuery);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.status(200).json({
                userId: user.userId,
                role: user.role,
                wallet: Number.isSafeInteger(user.walletBalanceMinor)
                    ? user.walletBalanceMinor / 100
                    : user.money,
                walletBalanceMinor: Number.isSafeInteger(user.walletBalanceMinor)
                    ? user.walletBalanceMinor
                    : Math.round((Number(user.money) + Number.EPSILON) * 100),
            });
        } catch (error) {
            console.error('AuthMe error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async logout(req, res) {
        const COOKIE_NAME = 'auth_token';
        
        try {
            // Clear the authentication cookie
            const cookieConfig = req.app.locals.runtimeConfig.cookie;
            res.clearCookie(COOKIE_NAME, {
                httpOnly: true,
                secure: cookieConfig.secure,
                sameSite: cookieConfig.sameSite,
                domain: cookieConfig.domain,
                path: '/',
            });
            const { maxAge, ...csrfClearOptions } = csrfCookieOptions(cookieConfig);
            void maxAge;
            res.clearCookie(CSRF_COOKIE, csrfClearOptions);
            
            res.status(200).json({ message: 'Logged out successfully' });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AuthController();
