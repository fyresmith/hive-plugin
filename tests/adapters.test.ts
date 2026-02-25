import test from 'node:test';
import assert from 'node:assert/strict';

import { AdapterRegistry } from '../src/collab/adapters/registry';
import { markdownAdapter } from '../src/collab/adapters/markdownAdapter';
import { canvasAdapter } from '../src/collab/adapters/canvasAdapter';
import { metadataAdapter } from '../src/collab/adapters/metadataAdapter';
import { isMetadataAllowedPath } from '../src/collab/adapters/metadataPolicy';

test('adapter registry resolves built-in adapters by path', () => {
  const registry = new AdapterRegistry();
  registry.register(markdownAdapter);
  registry.register(canvasAdapter);
  registry.register(metadataAdapter);

  assert.equal(registry.getByPath('notes/file.md')?.adapterId, 'markdown');
  assert.equal(registry.getByPath('boards/map.canvas')?.adapterId, 'canvas');
  if (isMetadataAllowedPath('.obsidian/appearance.json')) {
    assert.equal(registry.getByPath('.obsidian/appearance.json')?.adapterId, 'metadata');
  }
});

test('metadata adapter validates only allowlisted paths', () => {
  const contextAllowed = { filePath: '.obsidian/appearance.json' };
  const contextDenied = { filePath: '.obsidian/workspace.json' };

  assert.equal(metadataAdapter.validate('{"theme":"dark"}', contextAllowed), true);
  assert.equal(metadataAdapter.validate('{"theme":"dark"}', contextDenied), false);
});
