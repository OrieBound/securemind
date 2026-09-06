/**
 * PNG / JPEG only. Magic bytes, not the client Content-Type.
 * SVG and other scriptable formats are rejected.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export type AvatarImageKind = "image/jpeg" | "image/png";

export type InspectAvatarResult =
  | { ok: true; contentType: AvatarImageKind }
  | { ok: false; reason: string };

export function inspectAvatarBytes(buf: Buffer): InspectAvatarResult {
  if (!buf || buf.length < 8) {
    return { ok: false, reason: "That file is empty or too small to be an image." };
  }
  if (buf.length > AVATAR_MAX_BYTES) {
    return { ok: false, reason: "Avatar must be 2 MB or smaller." };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ok: true, contentType: "image/jpeg" };
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ok: true, contentType: "image/png" };
  }
  return { ok: false, reason: "Use a JPEG or PNG image." };
}
