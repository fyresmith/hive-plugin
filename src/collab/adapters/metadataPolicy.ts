const SAFE_METADATA_DEFAULTS = [
  '.obsidian/appearance.json',
  '.obsidian/community-plugins.json',
  '.obsidian/core-plugins.json',
  '.obsidian/hotkeys.json',
];

export const SAFE_METADATA_ALLOWLIST = new Set<string>(SAFE_METADATA_DEFAULTS);

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\//, '');
}

export function isMetadataAllowedPath(path: string): boolean {
  return SAFE_METADATA_ALLOWLIST.has(normalizePath(path));
}

export function isSafeFrontmatterKey(key: string): boolean {
  return ['tags', 'aliases', 'status', 'owner', 'reviewedAt', 'dueAt'].includes(key);
}

export function parseMetadataJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
