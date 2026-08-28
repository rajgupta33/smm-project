# Manual-task workflow rollout

## Compatibility

The rollout is additive. Existing `ManualTask` documents remain readable when `claimedAt`
or `resolvedAt` is absent. Existing status values are unchanged.

Before deploying schema validation, inventory:

- `notes` longer than 4,000 characters;
- `proof` longer than 2,000 characters or non-HTTP(S) proof values;
- assigned tasks whose `assignedTo` no longer resolves to a current administrator;
- terminal tasks whose associated order is not in the corresponding completed/refunded state.

Do not silently truncate or rewrite historical task evidence. Resolve exceptions with an
audited migration decision.

## Index

Create the additive operational index after inspecting existing indexes:

```javascript
db.manualtasks.createIndex({ status: 1, dueAt: 1 })
```

The existing unique `orderId` constraint and status/assignee indexes remain in place.

## Staging verification

Use a transaction-capable MongoDB deployment and verify:

1. two simultaneous claims produce one assignee;
2. a retry by that assignee is idempotent;
3. another admin cannot update the claimed task;
4. completion updates the order without refunding;
5. rejection/cancellation updates the task, order, ledger, and timeline atomically;
6. a duplicate terminal request does not create another ledger credit;
7. a forced transaction failure leaves every affected document unchanged.

