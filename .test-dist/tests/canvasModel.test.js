"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const canvasModel_1 = require("../src/collab/canvasModel");
(0, node_test_1.default)('canvas model serialization is deterministic by id ordering', () => {
    const model = (0, canvasModel_1.canonicalizeCanvasModel)({
        nodes: [{ id: 'b' }, { id: 'a' }],
        edges: [{ id: 'e2' }, { id: 'e1' }],
    });
    const serialized = (0, canvasModel_1.serializeCanvasModel)(model);
    const reparsed = (0, canvasModel_1.parseCanvasModel)(serialized);
    strict_1.default.equal(reparsed.nodes[0].id, 'a');
    strict_1.default.equal(reparsed.nodes[1].id, 'b');
    strict_1.default.equal(reparsed.edges[0].id, 'e1');
});
(0, node_test_1.default)('canvas merge keeps delete over stale update', () => {
    const base = (0, canvasModel_1.canonicalizeCanvasModel)({
        nodes: [{ id: 'n1', updatedAt: 100, deleted: true }],
        edges: [],
    });
    const incoming = (0, canvasModel_1.canonicalizeCanvasModel)({
        nodes: [{ id: 'n1', updatedAt: 90, deleted: false, label: 'stale' }],
        edges: [],
    });
    const merged = (0, canvasModel_1.mergeCanvasModels)(base, incoming);
    strict_1.default.equal(merged.nodes[0].deleted, true);
});
