# Production migration runbook

`npm run migrate:production` is intentionally not part of API or worker startup. Rehearse it against a restored snapshot, review the dry-run, take a fresh backup, pause writes, and obtain owner approval before production apply.

Capture a record-ID baseline before applying migrations, then compare it afterward:

```text
npm run verify:migration -- --capture-baseline migration-baseline-pre.json
npm run migrate:production:dry-run
npm run migrate:production
npm run verify:migration -- --baseline migration-baseline-pre.json
```

The baseline contains database record identifiers and is gitignored. Store it as a controlled deployment artifact. Capture refuses to overwrite an existing file. Verification performs reads only and checks collection counts, wallet/cache consistency, ledger arithmetic and duplicates, catalogue/provider mappings, declared unique indexes, and the continued existence of every baseline order and transaction.

## Ordered sequence

| Order | Migration | Collections affected | Idempotency and expected checks |
|---:|---|---|---|
| 1 | wallet minor units | `users` | Updates only users missing `walletBalanceMinor`. Invalid count must be zero or every exception approved. Post-apply scanned count should be zero. |
| 2 | legacy catalogue | `services`, `catalogueservices`, `providers`, `provideroffers` | Stable legacy IDs/slugs; links only missing references. Invalid/conflict counts must be zero. |
| 3 | drip-feed workflow v2 | `dripfeedorders`, `dripfeedruns`, `orders` | Ignores v2 rows. Non-terminal legacy work becomes reconciliation-required, never blindly resubmitted. Review every affected order. |
| 4 | durable job dispatch | `jobdispatches`, `orders` | Stable unique job keys queue safe intents. Previously claimed attempts become reconciliation-required. Review both counts. |
| 5 | provider sync indexes | `providersyncruns` | Creates declared additive indexes. Check duplicates for the unique actor/request index. |
| 6 | order reconciliation indexes | `orderreconciliations` | Creates collection if absent and additive indexes. Check duplicates for the unique resolver/request index. |
| 7 | production model indexes | all application collections | Creates every index declared by current schemas without dropping existing indexes. Preflight all unique keys for duplicates; any conflict stops the run. |

The runner uses one child process per migration and stops on the first non-zero exit. `npm run migrate:production:dry-run` reads and reports planned index definitions without writes.

## Recovery and rollback

These migrations are additive; there is no automated destructive rollback. Recovery is application rollback plus database restore or a reviewed forward repair. Never drop new collections/indexes or remove additive fields while new-format records exist. Code rollback after new order formats are written is unsafe; pause intake and retain compatible processing code.

Before apply, capture collection counts, index lists, users missing `walletBalanceMinor`, catalogue link counts, non-v2 drip-feed count, pending/submitting orders, durable dispatch count, and reconciliation-required count. Capture the same values afterward and retain all output.

## Wallet reconciliation

For every sampled user verify:

- `walletBalanceMinor` equals the approved opening balance plus ledger credits minus debits after the migration boundary;
- each payment credit has one `WalletLedger` and the referenced `Payment.walletLedgerId`;
- each new order debit has one ledger row matching its pricing total;
- refunds reference the original order/reconciliation source and never exceed the debit;
- no duplicate ledger idempotency keys exist;
- legacy `money` equals `walletBalanceMinor / 100`.

Any mismatch blocks production. Preserve the snapshot and logs rather than manually editing balances.
