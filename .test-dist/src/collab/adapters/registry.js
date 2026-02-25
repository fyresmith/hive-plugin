"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterRegistry = void 0;
class AdapterRegistry {
    constructor() {
        this.adapters = new Map();
    }
    register(adapter) {
        this.adapters.set(adapter.adapterId, adapter);
        return () => {
            this.adapters.delete(adapter.adapterId);
        };
    }
    getById(adapterId) {
        return this.adapters.get(adapterId) ?? null;
    }
    getByPath(path) {
        for (const adapter of this.adapters.values()) {
            if (adapter.supportsPath(path)) {
                return adapter;
            }
        }
        return null;
    }
    listDescriptors() {
        return [...this.adapters.values()].map((adapter) => ({
            adapterId: adapter.adapterId,
            version: adapter.version,
            capabilities: [...adapter.capabilities],
        }));
    }
    listCapabilities() {
        const out = {};
        for (const adapter of this.adapters.values()) {
            out[adapter.adapterId] = {
                version: adapter.version,
                capabilities: [...adapter.capabilities],
            };
        }
        return out;
    }
}
exports.AdapterRegistry = AdapterRegistry;
