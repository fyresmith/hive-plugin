"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canvasAdapter = void 0;
const canvasModel_1 = require("../canvasModel");
exports.canvasAdapter = {
    adapterId: 'canvas',
    version: '2.0.0',
    capabilities: ['structured_model', 'legacy_text_bridge', 'deterministic_order'],
    supportsPath(path) {
        return path.toLowerCase().endsWith('.canvas');
    },
    parse(serialized) {
        return (0, canvasModel_1.parseCanvasModel)(serialized);
    },
    serialize(model) {
        return (0, canvasModel_1.serializeCanvasModel)(model);
    },
    applyLocal(model, change) {
        const next = typeof change === 'string' ? (0, canvasModel_1.parseCanvasModel)(change) : (0, canvasModel_1.canonicalizeCanvasModel)(change);
        return (0, canvasModel_1.mergeCanvasModels)(model, next);
    },
    applyRemote(model, change) {
        const next = typeof change === 'string' ? (0, canvasModel_1.parseCanvasModel)(change) : (0, canvasModel_1.canonicalizeCanvasModel)(change);
        return (0, canvasModel_1.mergeCanvasModels)(model, next);
    },
    merge(base, incoming) {
        return (0, canvasModel_1.mergeCanvasModels)(base, incoming);
    },
    validate(value, _context) {
        if (typeof value === 'string') {
            try {
                JSON.parse(value);
                return true;
            }
            catch {
                return false;
            }
        }
        return typeof value === 'object' && value !== null;
    },
    supports(featureFlag) {
        return this.capabilities.includes(featureFlag);
    },
};
