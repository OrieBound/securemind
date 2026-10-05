"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AVATAR_OUTPUT_PX,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  clampOffset,
  displayedSize,
  sourceCropRect,
} from "@/lib/avatar-crop";

const VIEW = 280;

export function AvatarCropDialog({
  file,
  onCancel,
  onAccept,
  title = "Choose the part that shows",
  description = "Drag to reposition, scroll or use the slider to zoom. Accept saves a square photo for your profile and the header.",
  mask = "circle",
}: {
  file: File;
  onCancel: () => void;
  onAccept: (blob: Blob) => void | Promise<void>;
  title?: string;
  description?: string;
  /** Circle for profile photos. Rounded matches the sidebar portal slot. */
  mask?: "circle" | "rounded";
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ offsetX: 0, offsetY: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    setZoom(1);
    setOffset({ offsetX: 0, offsetY: 0 });
    setNatural(null);
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const applyOffset = useCallback((ox: number, oy: number, nextZoom = zoom) => {
    if (!natural) return;
    setOffset(clampOffset(natural.w, natural.h, VIEW, nextZoom, ox, oy));
  }, [natural, zoom]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.offsetX, oy: offset.offsetY };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    applyOffset(dragRef.current.ox + dx, dragRef.current.oy + dy);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    if (!natural) return;
    const next = Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, zoom + (e.deltaY < 0 ? 0.12 : -0.12)));
    setZoom(next);
    applyOffset(offset.offsetX, offset.offsetY, next);
  }

  async function accept() {
    const img = imgRef.current;
    if (!img || !natural) return;
    setBusy(true);
    setError(null);
    try {
      const { sx, sy, sSize } = sourceCropRect(
        natural.w,
        natural.h,
        VIEW,
        zoom,
        offset.offsetX,
        offset.offsetY,
      );
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_OUTPUT_PX;
      canvas.height = AVATAR_OUTPUT_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not crop that image.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);
      const blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, "image/jpeg", 0.9);
      });
      if (!blob) throw new Error("Could not crop that image.");
      await onAccept(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop that image.");
      setBusy(false);
    }
  }

  const layout = natural ? displayedSize(natural.w, natural.h, VIEW, zoom) : null;
  const frameRadius = mask === "circle" ? "9999px" : "40%";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-crop-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-popover border border-foreground/10 p-5 shadow-2xl space-y-4">
        <div>
          <h2 id="avatar-crop-title" className="text-section">
            {title}
          </h2>
          <p className="text-sm text-foreground/45 mt-1.5 leading-relaxed">
            {description}
          </p>
        </div>

        <div className="flex justify-center">
          <div
            className="relative size-[280px] overflow-hidden border border-foreground/15 bg-foreground/[0.06] touch-none cursor-grab active:cursor-grabbing"
            style={{ borderRadius: frameRadius }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={src}
                alt=""
                draggable={false}
                className="absolute max-w-none select-none pointer-events-none"
                style={
                  layout
                    ? {
                        width: layout.w,
                        height: layout.h,
                        left: (VIEW - layout.w) / 2 + offset.offsetX,
                        top: (VIEW - layout.h) / 2 + offset.offsetY,
                      }
                    : { opacity: 0 }
                }
                onLoad={e => {
                  const el = e.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
              />
            )}
            <div
              className="pointer-events-none absolute inset-0 ring-1 ring-white/25"
              style={{ borderRadius: frameRadius }}
              aria-hidden
            />
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Zoom</span>
          <input
            type="range"
            min={AVATAR_ZOOM_MIN}
            max={AVATAR_ZOOM_MAX}
            step={0.01}
            value={zoom}
            onChange={e => {
              const next = Number(e.target.value);
              setZoom(next);
              applyOffset(offset.offsetX, offset.offsetY, next);
            }}
            className="w-full accent-indigo-400"
          />
        </label>

        {error && (
          <p className="text-[0.75rem] text-red-200/90" role="alert">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-foreground/15 px-3 py-2 text-[0.75rem] cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !natural}
            onClick={() => void accept()}
            className="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-3 py-2 text-[0.75rem] font-medium text-indigo-100 cursor-pointer disabled:opacity-40 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {busy ? "Saving…" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
