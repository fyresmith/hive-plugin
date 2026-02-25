"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const registry_1 = require("../src/collab/adapters/registry");
const markdownAdapter_1 = require("../src/collab/adapters/markdownAdapter");
const canvasAdapter_1 = require("../src/collab/adapters/canvasAdapter");
const metadataAdapter_1 = require("../src/collab/adapters/metadataAdapter");
const metadataPolicy_1 = require("../src/collab/adapters/metadataPolicy");
(0, node_test_1.default)('adapter registry resolves built-in adapters by path', () => {
    const registry = new registry_1.AdapterRegistry();
    registry.register(markdownAdapter_1.markdownAdapter);
    registry.register(canvasAdapter_1.canvasAdapter);
    registry.register(metadataAdapter_1.metadataAdapter);
    strict_1.default.equal(registry.getByPath('notes/file.md')?.adapterId, 'markdown');
    strict_1.default.equal(registry.getByPath('boards/map.canvas')?.adapterId, 'canvas');
    if ((0, metadataPolicy_1.isMetadataAllowedPath)('.obsidian/appearance.json')) {
        strict_1.default.equal(registry.getByPath('.obsidian/appearance.json')?.adapterId, 'metadata');
    }
});
(0, node_test_1.default)('metadata adapter validates only allowlisted paths', () => {
    const contextAllowed = { filePath: '.obsidian/appearance.json' };
    const contextDenied = { filePath: '.obsidian/workspace.json' };
    strict_1.default.equal(metadataAdapter_1.metadataAdapter.validate('{"theme":"dark"}', contextAllowed), true);
    strict_1.default.equal(metadataAdapter_1.metadataAdapter.validate('{"theme":"dark"}', contextDenied), false);
});
