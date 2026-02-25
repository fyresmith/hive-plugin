# Hive Plugin

Obsidian plugin for collaborative vault editing using Hive server auth/sync.

## Development

```bash
npm ci
npm run dev
```

Build once:

```bash
npm run build
```

Build and verify BRAT-ready assets locally:

```bash
npm run build:brat
```

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
