const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const userController = require('../controllers/userController');

test('customer password change response never returns plaintext password', async () => {
    const originalFindOne = User.findOne;
    const originalUpdateOne = User.updateOne;
    const originalCompare = bcrypt.compare;
    const originalHash = bcrypt.hash;
    User.findOne = async () => ({ _id: '507f1f77bcf86cd799439011', password: 'stored-hash' });
    User.updateOne = async () => ({ modifiedCount: 1 });
    bcrypt.compare = async () => true;
    bcrypt.hash = async () => 'new-hash';
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    try {
        await userController.changePassword({
            body: { currentPassword: 'OldPassword1!', newPassword: 'NewPassword1!' },
            user: { id: 'customer' },
        }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { message: 'Password changed successfully' });
        assert.equal(JSON.stringify(res.body).includes('NewPassword1!'), false);
    } finally {
        User.findOne = originalFindOne;
        User.updateOne = originalUpdateOne;
        bcrypt.compare = originalCompare;
        bcrypt.hash = originalHash;
    }
});
