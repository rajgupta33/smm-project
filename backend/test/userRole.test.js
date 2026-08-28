const assert = require('node:assert/strict');
const test = require('node:test');

const User = require('../models/User');

test('User role is constrained to user or admin', () => {
    const invalidUser = new User({
        userId: 'role-test-user',
        password: 'not-persisted',
        role: 'superadmin',
    });
    const validationError = invalidUser.validateSync();
    assert.ok(validationError.errors.role);

    for (const role of ['user', 'admin']) {
        const validUser = new User({
            userId: `${role}-role-test`,
            password: 'not-persisted',
            role,
        });
        assert.equal(validUser.validateSync(), undefined);
    }
});
