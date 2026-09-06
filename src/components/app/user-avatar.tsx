"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  avatarPresetById,
  initialsFrom,
} from "@/lib/avatar-presets";

export const AVATAR_CHANGED_EVENT = "sm-avatar-changed";

export function notifyAvatarChanged() {
  window.dispatchEvent(new Event(AVATAR_CHANGED_EVENT));
}

type Size = "sm" | "md" | "lg" | "xl";

const SIZE: Record<Size, string> = {
  sm: "size-7 text-[0.65rem]",
  md: "size-10 text-base",
  lg: "size-14 text-xl",
  xl: "size-20 text-2xl",
};

export function UserAvatarFace({
  presetId,
  displayName,
  email,
  photoUrl,
  size = "md",
  className,
}: {
  presetId: string;
  displayName: string | null;
  email: string | null;
  photoUrl?: string | null;
  size?: Size;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [photoUrl]);

  const preset = avatarPresetById(presetId);
  const dim = SIZE[size];
  if (photoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        onError={() => setBroken(true)}
        className={cn("rounded-full shrink-0 object-cover", dim, className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full shrink-0 select-none",
        dim,
        className,
      )}
      style={{ backgroundColor: `${preset.color}33`, color: preset.color }}
      aria-hidden
    >
      {preset.glyph || initialsFrom(displayName, email)}
    </span>
  );
}

/** Header chip — loads the signed-in profile so a custom photo replaces SM initials. */
export function SessionAvatar({ size = "sm" }: { size?: Size }) {
  const [state, setState] = useState<{
    presetId: string;
    displayName: string | null;
    email: string | null;
    photoUrl: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me/profile", { credentials: "same-origin" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        profile?: {
          avatarPreset: string;
          displayName: string | null;
          email: string | null;
          avatarUrl: string | null;
        };
      };
      const p = body.profile;
      if (!p) return;
      setState({
        presetId: p.avatarPreset,
        displayName: p.displayName,
        email: p.email,
        photoUrl: p.avatarUrl,
      });
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(AVATAR_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onChange);
  }, [load]);

  if (!state) {
    return (
      <span
        className={cn(
          "rounded-full inline-flex items-center justify-center shrink-0 bg-indigo-500/20 text-indigo-200",
          SIZE[size],
        )}
        aria-hidden
      >
        SM
      </span>
    );
  }

  return (
    <UserAvatarFace
      presetId={state.presetId}
      displayName={state.displayName}
      email={state.email}
      photoUrl={state.photoUrl}
      size={size}
    />
  );
}
