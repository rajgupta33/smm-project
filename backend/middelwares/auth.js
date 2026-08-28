require('dotenv').config();

const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { buildUserIdQuery } = require('../utils/userId');

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required');
    }
    return secret;
}

async function findCurrentUser(decodedToken) {
    if (decodedToken.sub) {
        return User.findById(decodedToken.sub);
    }

    const userIdQuery = buildUserIdQuery(decodedToken.id);
    return userIdQuery ? User.findOne(userIdQuery) : null;
}

async function authenticate(req, res, next) {
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    const token = cookies.auth_token;

    if (!token) {
        return res.status(401).json({ message: 'No auth token provided' });
    }

    try {
        const decodedToken = jwt.verify(token, getJwtSecret());
        const currentUser = await findCurrentUser(decodedToken);

        if (!currentUser) {
            return res.status(401).json({ message: 'Authenticated user no longer exists' });
        }

        req.currentUser = currentUser;
        req.user = {
            id: currentUser.userId,
            databaseId: currentUser._id,
            role: currentUser.role,
        };
        req.payload = req.body;
        return next();
    } catch (error) {
        if (error.message === 'JWT_SECRET environment variable is required') {
            return next(error);
        }
        return res.status(401).json({ message: 'Invalid request' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.currentUser || req.currentUser.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    return next();
}

module.exports = {
    authenticate,
    getJwtSecret,
    requireAdmin,
};
