require('dotenv').config();

const bcrypt = require('bcrypt');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const User = require('../models/User');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');
const { normalizeUserId } = require('../utils/userId');

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--userId') args.userId = argv[++i];
        else if (token === '--password') args.password = argv[++i];
    }
    return args;
}

async function promptForCredentials(existing) {
    if (existing.userId && existing.password) return existing;

    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
        const userId = existing.userId || (await rl.question('Admin user ID: ')).trim();
        const password = existing.password || (await rl.question(
            'Admin password (min 8 chars, entered in plain sight in this terminal): '
        ));
        return { userId, password };
    } finally {
        rl.close();
    }
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const { userId: rawUserId, password } = await promptForCredentials(args);

    const normalizedUserId = normalizeUserId(rawUserId);
    if (!normalizedUserId) {
        console.error('A non-empty user ID is required.');
        process.exitCode = 1;
        return;
    }
    if (typeof password !== 'string' || password.length < 8) {
        console.error('A password of at least 8 characters is required.');
        process.exitCode = 1;
        return;
    }

    await connectToDatabase();

    const existingUser = await User.findOne({ userId: normalizedUserId });
    if (existingUser) {
        if (existingUser.role === 'admin') {
            console.log(`User "${normalizedUserId}" already exists and is already an admin. No changes made.`);
            return;
        }
        console.error(
            `User "${normalizedUserId}" already exists with role "${existingUser.role}". ` +
            'Refusing to overwrite an existing account. Use the admin panel to change roles instead.'
        );
        process.exitCode = 1;
        return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = new User({
        userId: normalizedUserId,
        password: hashedPassword,
        role: 'admin',
        money: 0,
        walletBalanceMinor: 0,
        services: [],
    });
    await admin.save();

    console.log(`Admin user "${normalizedUserId}" created successfully.`);
}

run()
    .catch((error) => {
        console.error('Failed to create admin user:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectFromDatabase();
    });
