"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadataAdapter = void 0;
const metadataPolicy_1 = require("./metadataPolicy");
exports.metadataAdapter = {
    adapterId: 'metadata',
    version: '1.0.0',
    capabilities: ['whitelist_policy', 'validation'],
    supportsPath(path) {
        return (0, metadataPolicy_1.isMetadataAllowedPath)(path);
    },
    parse(serialized) {
        return (0, metadataPolicy_1.parseMetadataJson)(serialized) ?? {};
    },
    serialize(model) {
        return JSON.stringify(model, null, 2);
    },
    applyLocal(model, change) {
        return { ...model, ...change };
    },
    applyRemote(model, change) {
        return { ...model, ...change };
    },
    merge(base, incoming) {
        return { ...base, ...incoming };
    },
    validate(value, context) {
        if (!(0, metadataPolicy_1.isMetadataAllowedPath)(context.filePath))
            return false;
        if (typeof value === 'string') {
            return (0, metadataPolicy_1.parseMetadataJson)(value) !== null;
        }
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    },
    supports(featureFlag) {
        return this.capabilities.includes(featureFlag);
    },
};
