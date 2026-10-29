/**
 * Keeps the customer-facing service list consistent with the catalogue
 * takedowns the availability scan performs. A legacy Service mapped to an
 * inactive or hidden CatalogueService must disappear from the list, not just
 * fail at order time — otherwise "auto-hide" only blocks checkout while the
 * dead service still shows up as orderable.
 */
function filterServicesByCatalogueAvailability(services, unavailableCatalogueIds) {
    return services.filter((service) => (
        !service.catalogueServiceId || !unavailableCatalogueIds.has(String(service.catalogueServiceId))
    ));
}

async function loadUnavailableCatalogueIds(services, CatalogueServiceModel) {
    const catalogueIds = [...new Set(
        services.map((service) => service.catalogueServiceId).filter(Boolean).map(String)
    )];
    if (!catalogueIds.length) return new Set();
    const hidden = await CatalogueServiceModel.find({
        _id: { $in: catalogueIds },
        $or: [{ active: false }, { visibility: 'HIDDEN' }],
    }).select('_id').lean();
    return new Set(hidden.map((doc) => String(doc._id)));
}

module.exports = { filterServicesByCatalogueAvailability, loadUnavailableCatalogueIds };
