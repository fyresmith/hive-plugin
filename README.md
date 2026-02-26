# Hive Plugin

Obsidian plugin for collaborative vault editing using Hive server auth/sync.

## Managed Vault Mode

Hive now runs only in Managed Vaults (`.obsidian/hive-managed.json` present).
In non-managed vaults, Hive shows setup actions only:

- authenticate using invite link
- create/join a managed vault

## Invite-Shell Onboarding

When server onboarding mode is `invite-shell`, new members can:

1. Open owner-provided invite link.
2. Sign in/create account on the claim page.
3. Download a preconfigured empty vault shell zip.
4. Open extracted vault in Obsidian desktop.

The bundled plugin stores a short-lived bootstrap token and exchanges it on first open.
After exchange, Hive saves the normal session token and runs initial sync.

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
