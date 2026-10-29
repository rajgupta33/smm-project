const assert = require('node:assert/strict');
const test = require('node:test');
const {
    filterServicesByCatalogueAvailability,
    loadUnavailableCatalogueIds,
} = require('../services/catalogueVisibilityService');

test('a service with no catalogue mapping always stays visible', () => {
    const services = [{ serviceId: 'legacy-1', catalogueServiceId: null }];
    assert.deepEqual(filterServicesByCatalogueAvailability(services, new Set()), services);
});

test('a service mapped to a hidden or inactive catalogue entry is removed from the list', () => {
    const services = [
        { serviceId: 'a', catalogueServiceId: 'cat-1' },
        { serviceId: 'b', catalogueServiceId: 'cat-2' },
        { serviceId: 'c', catalogueServiceId: null },
    ];
    const visible = filterServicesByCatalogueAvailability(services, new Set(['cat-1']));
    assert.deepEqual(visible.map((service) => service.serviceId), ['b', 'c']);
});

test('loadUnavailableCatalogueIds queries only the distinct mapped catalogue IDs and skips the DB when none exist', async () => {
    let query;
    const CatalogueServiceModel = {
        find(filter) {
            query = filter;
            return { select: () => ({ lean: async () => [{ _id: 'cat-1' }] }) };
        },
    };
    const services = [
        { catalogueServiceId: 'cat-1' },
        { catalogueServiceId: 'cat-1' },
        { catalogueServiceId: 'cat-2' },
        { catalogueServiceId: null },
    ];
    const unavailable = await loadUnavailableCatalogueIds(services, CatalogueServiceModel);
    assert.deepEqual(query._id.$in.sort(), ['cat-1', 'cat-2']);
    assert.deepEqual(query.$or, [{ active: false }, { visibility: 'HIDDEN' }]);
    assert.deepEqual([...unavailable], ['cat-1']);

    const noQuery = { find() { throw new Error('must not query when nothing is mapped'); } };
    assert.deepEqual(await loadUnavailableCatalogueIds([{ catalogueServiceId: null }], noQuery), new Set());
});
