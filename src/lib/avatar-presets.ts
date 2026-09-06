/**
 * Curated avatar presets. A custom JPEG/PNG can replace these in the header.
 */

export type AvatarPreset = {
  id: string;
  label: string;
  /** CSS background / accent */
  color: string;
  /** Single emoji glyph for the circle */
  glyph: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "shield", label: "Shield", color: "#6366f1", glyph: "🛡️" },
  { id: "orbit", label: "Orbit", color: "#0ea5e9", glyph: "🌀" },
  { id: "lock", label: "Lock", color: "#14b8a6", glyph: "🔐" },
  { id: "bolt", label: "Bolt", color: "#f59e0b", glyph: "⚡" },
  { id: "leaf", label: "Leaf", color: "#22c55e", glyph: "🌿" },
  { id: "moon", label: "Moon", color: "#8b5cf6", glyph: "🌙" },
  { id: "compass", label: "Compass", color: "#ef4444", glyph: "🧭" },
  { id: "spark", label: "Spark", color: "#ec4899", glyph: "✨" },
];

export const DEFAULT_AVATAR_PRESET = "shield";

export function isAvatarPresetId(id: unknown): id is string {
  return typeof id === "string" && AVATAR_PRESETS.some(p => p.id === id);
}

export function avatarPresetById(id: string | null | undefined): AvatarPreset {
  return AVATAR_PRESETS.find(p => p.id === id) ?? AVATAR_PRESETS[0]!;
}

/** Initials fallback when no display name (email local-part). */
export function initialsFrom(displayName: string | null | undefined, email: string | null | undefined): string {
  const name = displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const local = email?.split("@")[0]?.trim();
  if (local) return local.slice(0, 2).toUpperCase();
  return "?";
}
