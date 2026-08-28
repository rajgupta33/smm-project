const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema({
    serviceId: {
        type: String,
        required: true,
        unique: true
    },
    service: {
        type: String,
        required: true,
    },
    internalName: {
        type: String,
        required: true,
    },
    name: {
        type: String,
        required: true
    },
    rate: {
        type: Number,
        required: true
    },
    min:{
        type: String,
        required: true
    },
    max: {
        type: String,
        required: true
    },
    refill: {
        type: Boolean,
        default: false
    },
    markupOverrideBps: {
        type: Number,
        default: null,
        min: 0,
        validate: {
            validator: (value) => value === null || Number.isSafeInteger(value),
            message: 'markupOverrideBps must be an integer number of basis points',
        },
    },
    catalogueServiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CatalogueService',
        default: null,
    },
    catalogueMigration: {
        source: { type: String, default: null },
        migratedAt: { type: Date, default: null },
    },
});

ServiceSchema.index({ catalogueServiceId: 1 }, { sparse: true });

module.exports = mongoose.model('Service', ServiceSchema);
