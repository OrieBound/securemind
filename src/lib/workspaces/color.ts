/** Workspace accent stored as #rrggbb and painted into CSS. Anything else is rejected. */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeWorkspaceColor(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  return `#${hex.toLowerCase()}`;
}
