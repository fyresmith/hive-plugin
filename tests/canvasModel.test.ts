import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeCanvasModel,
  mergeCanvasModels,
  parseCanvasModel,
  serializeCanvasModel,
} from '../src/collab/canvasModel';

test('canvas model serialization is deterministic by id ordering', () => {
  const model = canonicalizeCanvasModel({
    nodes: [{ id: 'b' }, { id: 'a' }],
    edges: [{ id: 'e2' }, { id: 'e1' }],
  });

  const serialized = serializeCanvasModel(model);
  const reparsed = parseCanvasModel(serialized);

  assert.equal(reparsed.nodes[0].id, 'a');
  assert.equal(reparsed.nodes[1].id, 'b');
  assert.equal(reparsed.edges[0].id, 'e1');
});

test('canvas merge keeps delete over stale update', () => {
  const base = canonicalizeCanvasModel({
    nodes: [{ id: 'n1', updatedAt: 100, deleted: true }],
    edges: [],
  });
  const incoming = canonicalizeCanvasModel({
    nodes: [{ id: 'n1', updatedAt: 90, deleted: false, label: 'stale' }],
    edges: [],
  });

  const merged = mergeCanvasModels(base, incoming);
  assert.equal(merged.nodes[0].deleted, true);
});
