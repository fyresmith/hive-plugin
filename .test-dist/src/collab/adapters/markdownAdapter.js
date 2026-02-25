"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markdownAdapter = void 0;
function parseMarkdown(serialized) {
    return { content: typeof serialized === 'string' ? serialized : '' };
}
function applyChange(model, change) {
    if (typeof change === 'string') {
        return { content: change };
    }
    if (change && typeof change === 'object' && typeof change.content === 'string') {
        return { content: change.content };
    }
    return model;
}
exports.markdownAdapter = {
    adapterId: 'markdown',
    version: '1.0.0',
    capabilities: ['yjs_text', 'awareness', 'cas'],
    supportsPath(path) {
        return path.toLowerCase().endsWith('.md');
    },
    parse(serialized) {
        return parseMarkdown(serialized);
    },
    serialize(model) {
        return model.content;
    },
    applyLocal(model, change) {
        return applyChange(model, change);
    },
    applyRemote(model, change) {
        return applyChange(model, change);
    },
    merge(base, incoming) {
        return incoming;
    },
    validate(value, _context) {
        return typeof value === 'string' || (typeof value === 'object' && value !== null);
    },
    supports(featureFlag) {
        return this.capabilities.includes(featureFlag);
    },
};
