"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_METADATA_ALLOWLIST = void 0;
exports.isMetadataAllowedPath = isMetadataAllowedPath;
exports.isSafeFrontmatterKey = isSafeFrontmatterKey;
exports.parseMetadataJson = parseMetadataJson;
const SAFE_METADATA_DEFAULTS = [
    '.obsidian/appearance.json',
    '.obsidian/community-plugins.json',
    '.obsidian/core-plugins.json',
    '.obsidian/hotkeys.json',
];
exports.SAFE_METADATA_ALLOWLIST = new Set(SAFE_METADATA_DEFAULTS);
function normalizePath(path) {
    return path.replace(/\\/g, '/').replace(/^\//, '');
}
function isMetadataAllowedPath(path) {
    return exports.SAFE_METADATA_ALLOWLIST.has(normalizePath(path));
}
function isSafeFrontmatterKey(key) {
    return ['tags', 'aliases', 'status', 'owner', 'reviewedAt', 'dueAt'].includes(key);
}
function parseMetadataJson(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
