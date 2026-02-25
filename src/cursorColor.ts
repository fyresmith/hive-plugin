const COLOR_PALETTE = [
  '#e06c75', '#98c379', '#e5c07b', '#61afef',
  '#c678dd', '#56b6c2', '#d19a66', '#abb2bf',
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeCursorColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function getUserColor(discordId: string): string {
  const sum = discordId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return COLOR_PALETTE[sum % COLOR_PALETTE.length];
}

export function resolveUserColor(discordId: string, preferredColor?: string | null): string {
  return normalizeCursorColor(preferredColor) ?? getUserColor(discordId);
}

export function toCursorHighlight(color: string): string {
  return `${color}33`;
}
