/**
 * Square crop math for the avatar picker. Viewport pixels → source pixels.
 */

export const AVATAR_OUTPUT_PX = 512;
export const AVATAR_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const AVATAR_ZOOM_MIN = 1;
export const AVATAR_ZOOM_MAX = 3;

export function coverScale(imgW: number, imgH: number, viewport: number): number {
  if (imgW <= 0 || imgH <= 0 || viewport <= 0) return 1;
  return Math.max(viewport / imgW, viewport / imgH);
}

export function displayedSize(
  imgW: number,
  imgH: number,
  viewport: number,
  zoom: number,
): { w: number; h: number; scale: number } {
  const scale = coverScale(imgW, imgH, viewport) * Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, zoom));
  return { w: imgW * scale, h: imgH * scale, scale };
}

export function clampOffset(
  imgW: number,
  imgH: number,
  viewport: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): { offsetX: number; offsetY: number } {
  const { w, h } = displayedSize(imgW, imgH, viewport, zoom);
  const maxX = Math.max(0, (w - viewport) / 2);
  const maxY = Math.max(0, (h - viewport) / 2);
  return {
    offsetX: Math.min(maxX, Math.max(-maxX, offsetX)),
    offsetY: Math.min(maxY, Math.max(-maxY, offsetY)),
  };
}

/** Region of the source image that fills the square viewport. */
export function sourceCropRect(
  imgW: number,
  imgH: number,
  viewport: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): { sx: number; sy: number; sSize: number } {
  const { w, h, scale } = displayedSize(imgW, imgH, viewport, zoom);
  const clamped = clampOffset(imgW, imgH, viewport, zoom, offsetX, offsetY);
  const dispLeft = (viewport - w) / 2 + clamped.offsetX;
  const dispTop = (viewport - h) / 2 + clamped.offsetY;
  return {
    sx: (0 - dispLeft) / scale,
    sy: (0 - dispTop) / scale,
    sSize: viewport / scale,
  };
}
