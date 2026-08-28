# Wallet Minor-Unit Migration

This migration adds `User.walletBalanceMinor` as the authoritative cached wallet balance while preserving legacy `User.money` and all historical `Transaction` records.

## Preconditions

- Back up the target MongoDB database.
- Run against staging before production.
- Confirm the MongoDB deployment supports multi-document transactions.
- Stop or temporarily disable wallet mutations while the production apply pass runs.

## Dry run

From `backend/` with the target `MONGO_URI` configured:

```text
npm run migrate:wallet-minor
```

The command scans only users without `walletBalanceMinor`. It reports valid and invalid legacy balances and does not write by default.

Review every skipped user. Do not invent or silently correct an invalid balance.

## Apply

```text
npm run migrate:wallet-minor -- --apply
```

For each still-unmigrated valid user, the script writes:

- `walletBalanceMinor = round(money * 100)`;
- source `legacy_money_backfill`;
- the original legacy balance;
- migration timestamp.

The update predicate includes `walletBalanceMinor: { $exists: false }`, so rerunning the script does not overwrite an already migrated balance.

## Required indexes

Create and verify these indexes during the controlled deployment:

```text
walletledgers: { idempotencyKey: 1 } UNIQUE
walletledgers: { userId: 1, createdAt: -1 }
walletledgers: { sourceType: 1, sourceId: 1 }
orders: { idempotencyKey: 1 } UNIQUE SPARSE
```

Check for duplicate non-empty idempotency keys before creating either unique index. Do not use a destructive index synchronization command against production.

## Verification

- Re-run the dry run; expected scanned count is zero except deliberately unresolved invalid users.
- Compare `walletBalanceMinor` with the approved legacy balance sample.
- Verify new admin adjustments and order debits create exactly one `WalletLedger` record.
- Confirm legacy `Transaction` records remain unchanged and visible in wallet history.

Do not remove `User.money` or `Transaction` during this phase. `money` remains a compatibility mirror, while new accounting authority is `walletBalanceMinor` plus `WalletLedger`.
