require('dotenv').config();

const User = require('../models/User');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');
const { legacyMajorToMinor } = require('../services/walletService');

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();

    const users = await User.find({ walletBalanceMinor: { $exists: false } })
        .select('_id userId money')
        .lean();

    const summary = {
        mode: applyChanges ? 'apply' : 'dry-run',
        scanned: users.length,
        valid: 0,
        invalid: 0,
        updated: 0,
    };

    for (const user of users) {
        let walletBalanceMinor;
        try {
            walletBalanceMinor = legacyMajorToMinor(user.money);
            summary.valid += 1;
        } catch (error) {
            summary.invalid += 1;
            console.error(`Skipping user ${user.userId}: ${error.message}`);
            continue;
        }

        if (!applyChanges) {
            continue;
        }

        const result = await User.updateOne(
            { _id: user._id, walletBalanceMinor: { $exists: false } },
            {
                $set: {
                    walletBalanceMinor,
                    walletBalanceMigration: {
                        source: 'legacy_money_backfill',
                        legacyMoney: user.money,
                        migratedAt: new Date(),
                    },
                },
            }
        );
        summary.updated += result.modifiedCount;
    }

    console.log(JSON.stringify(summary, null, 2));
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectFromDatabase();
    });
