const REQUIRED_METHODS = [
    'getServices',
    'placeOrder',
    'getOrderStatus',
    'requestRefill',
    'getRefillStatus',
];

function assertProviderAdapter(adapter) {
    for (const method of REQUIRED_METHODS) {
        if (!adapter || typeof adapter[method] !== 'function') {
            throw new Error(`Provider adapter must implement ${method}()`);
        }
    }
    return adapter;
}

module.exports = { REQUIRED_METHODS, assertProviderAdapter };
