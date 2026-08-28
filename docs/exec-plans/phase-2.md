# Phase 2: normalized catalogue/provider foundation

Status: implemented, pending production migration execution.

Delivered in this phase:

- additive `CatalogueService`, `Provider`, `ProviderOffer`, and `ProviderSyncRun` models;
- nullable legacy `Service.catalogueServiceId` mapping with provenance;
- a provider adapter contract around the existing SMM provider client;
- unchanged legacy customer catalogue and fulfilment behaviour;
- dry-run-default, conflict-safe legacy mapping tooling;
- authenticated admin inspection endpoints;
- manual report-only provider synchronization with no offer mutations.

Deferred deliberately:

- applying synchronization reports;
- automated scheduled synchronization;
- catalogue-based customer listing, assignments, pricing, or order placement;
- provider selection/failover;
- removal or rewriting of legacy `Service`.

The next phase must not cut over live order routing until migrated mappings, pricing parity, authorization parity, rollback, and historical access are verified against staging data.
