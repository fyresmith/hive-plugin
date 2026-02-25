# Hive Plugin

Obsidian plugin for collaborative vault editing using Hive server auth/sync.

## What shipped in the collaboration overhaul

- Active Editors panel (current file + workspace scope).
- Jump to collaborator + follow mode.
- Comment threads + task status toggles.
- Activity feed with scope/filter/grouping support.
- Notification preference sync (`all|focus|digest|mute`).
- Adapter registry with built-in `markdown`, `canvas`, and `metadata` adapters.
- Structured canvas canonicalization + merge semantics with legacy bridge compatibility.

## Development

```bash
npm ci
npm run dev
```

Build once:

```bash
npm run build
```

Run unit/conformance tests:

```bash
npm test
```

Build and verify BRAT-ready assets locally:

```bash
npm run build:brat
```

## Adapter Extension API

Register an adapter from plugin/runtime code:

```ts
const dispose = app.plugins.plugins.hive.registerCollabAdapter(adapterDefinition, optionalRoomFactory)
```

Adapter contract:

- `adapterId`, `version`, `capabilities`
- `supportsPath(path)`
- `parse(serialized, context)`
- `serialize(model, context)`
- `applyLocal(model, change, context)`
- `applyRemote(model, change, context)`
- `merge(base, incoming, context)`
- `validate(value, context)`
- `supports(featureFlag)`

Use the built-in adapters as reference in:

- `src/collab/adapters/markdownAdapter.ts`
- `src/collab/adapters/canvasAdapter.ts`
- `src/collab/adapters/metadataAdapter.ts`

## BRAT Beta Releases

This repo is configured to release BRAT-compatible assets from GitHub Releases:

- `manifest.json`
- `main.js`
- `styles.css`

Release workflow:

1. Run workflow `hive-plugin-release-tag`.
2. Select release type (`patch`, `minor`, `major`, `prerelease`, or `custom`).
3. Workflow bumps `package.json` and `manifest.json`, commits, and tags `vX.Y.Z`.
4. Tag triggers `hive-plugin-publish`, which builds and attaches release assets.

Testers can then install via BRAT using this repository URL.
