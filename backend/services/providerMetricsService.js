const Provider = require('../models/Provider');

async function recordProviderMetric(providerId, { success, timeout, latencyMs }) {
    try {
        const update = {
            $inc: {
                requestCount: 1,
                totalLatencyMs: latencyMs,
                ...(success ? { successCount: 1 } : {}),
                ...(!success && !timeout ? { failureCount: 1 } : {}),
                ...(timeout ? { timeoutCount: 1 } : {})
            }
        };

        if (success) {
            update.$set = { lastSuccessfulSyncAt: new Date(), healthStatus: 'HEALTHY' };
        } else {
            update.$set = { lastFailureAt: new Date() };
        }

        const provider = await Provider.findByIdAndUpdate(providerId, update, { new: true });
        
        if (provider) {
            // Recalculate Quality Score dynamically
            // Weight success rate heavily (e.g. 70%), average latency lightly (e.g. 30%)
            const total = provider.requestCount || 1;
            const successRate = (provider.successCount / total) * 100;
            
            const avgLatency = provider.totalLatencyMs / total;
            // Base latency 1000ms = 100 score, 10000ms = 0 score
            const latencyScore = Math.max(0, Math.min(100, 100 - ((avgLatency - 1000) / 90)));
            
            const qualityScore = Math.floor((successRate * 0.7) + (latencyScore * 0.3));
            
            if (provider.qualityScore !== qualityScore) {
                await Provider.findByIdAndUpdate(providerId, { qualityScore });
            }
        }
    } catch (error) {
        console.error('Error recording provider metric:', error);
    }
}

module.exports = { recordProviderMetric };

