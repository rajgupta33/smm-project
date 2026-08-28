# Normalized catalogue foundation

The normalized catalogue is additive. `CatalogueService` is the customer-facing product definition, `Provider` identifies a fulfilment integration, and `ProviderOffer` maps one provider's internal service ID to a catalogue service. The legacy `Service` collection remains the live source for customer listings, authorization, pricing, and order routing during this phase.

Money stored in provider offers is integer paise per `pricingUnit` (currently 1,000 units). Quantity limits are positive safe integers. Provider credentials are represented only by a server-side `credentialReference`, which is excluded from normal Mongoose queries.

New catalogue records created by the legacy backfill are `ASSIGNED_ONLY`, use conservative `legacy`/`uncategorized` classification, and carry migration provenance. No platform or category is inferred from free-form names.

## Administrative inspection

Authenticated admin routes expose read-only inspection:

- `GET /admin/catalogueServices`
- `GET /admin/providers`
- `GET /admin/providerOffers`

These routes do not alter customer-visible behaviour. A later, separately verified cutover must move listing, assignment, pricing, and order placement to catalogue IDs.
