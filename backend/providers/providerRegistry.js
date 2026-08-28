const {
    createLegacySmmProviderAdapter,
    legacySmmProviderAdapter,
} = require('./legacySmmProviderAdapter');

const adapters = new Map([
    ['LEGACY_SMM', legacySmmProviderAdapter],
]);

function getProviderAdapter(adapterType) {
    const adapter = adapters.get(adapterType);
    if (!adapter) throw new Error(`Unsupported provider adapter type: ${adapterType}`);
    return adapter;
}

function getCurrentProviderAdapter() {
    return getProviderAdapter('LEGACY_SMM');
}

class ProviderConfigurationError extends Error {
    constructor(message, code = 'INVALID_PROVIDER_CONFIGURATION') {
        super(message);
        this.name = 'ProviderConfigurationError';
        this.code = code;
        this.statusCode = 409;
    }
}

function resolveCredentialReference(reference, env = process.env) {
    if (typeof reference !== 'string' || !/^env:[A-Z][A-Z0-9_]*$/.test(reference)) {
        throw new ProviderConfigurationError(
            'Provider credential reference must name a server environment variable',
            'INVALID_PROVIDER_CREDENTIAL_REFERENCE'
        );
    }
    const environmentName = reference.slice(4);
    const value = env[environmentName];
    if (typeof value !== 'string' || !value.trim()) {
        throw new ProviderConfigurationError(
            'Configured provider credential is unavailable',
            'PROVIDER_CREDENTIAL_UNAVAILABLE'
        );
    }
    return value.trim();
}

function providerConnection(provider, env = process.env) {
    let parsedUrl;
    try {
        parsedUrl = new URL(provider?.apiBaseUrl);
    } catch {
        throw new ProviderConfigurationError('Provider API URL is invalid');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new ProviderConfigurationError('Provider API URL must use http or https');
    }
    if (!Number.isSafeInteger(provider.timeoutMs) || provider.timeoutMs < 1) {
        throw new ProviderConfigurationError('Provider timeout is invalid');
    }
    return {
        apiUrl: parsedUrl.toString(),
        apiKey: resolveCredentialReference(provider.credentialReference, env),
        timeoutMs: provider.timeoutMs,
    };
}

function getProviderAdapterForProvider(provider, options = {}) {
    if (!provider) throw new ProviderConfigurationError('Provider is required', 'PROVIDER_NOT_FOUND');
    if (!provider.enabled) throw new ProviderConfigurationError('Provider is disabled', 'PROVIDER_DISABLED');
    const connection = providerConnection(provider, options.env);
    if (provider.adapterType === 'LEGACY_SMM') {
        return createLegacySmmProviderAdapter(connection);
    }
    throw new ProviderConfigurationError(`Unsupported provider adapter type: ${provider.adapterType}`);
}

module.exports = {
    ProviderConfigurationError,
    getCurrentProviderAdapter,
    getProviderAdapter,
    getProviderAdapterForProvider,
    providerConnection,
    resolveCredentialReference,
};
