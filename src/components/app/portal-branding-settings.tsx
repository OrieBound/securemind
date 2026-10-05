"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AvatarCropDialog } from "@/components/app/avatar-crop-dialog";
import { ProductMark } from "@/components/app/product-mark";
import { sessionApiFetch } from "@/lib/client/api-base";
import { cn } from "@/lib/utils";
import { AVATAR_SOURCE_MAX_BYTES } from "@/lib/avatar-crop";
import { notifyPortalBrandingChanged } from "@/lib/portal-branding-events";
import {
  PORTAL_NAME_MAX,
  PORTAL_TAGLINE_MAX,
  defaultPortalChrome,
  type PortalChrome,
} from "@/lib/portal-branding-shared";

/** Admin editor for the sidebar portal. First card on Settings → Admin. */
export function PortalBrandingSettings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [chrome, setChrome] = useState<PortalChrome>(defaultPortalChrome);
  const [name, setName] = useState(defaultPortalChrome().name);
  const [tagline, setTagline] = useState(defaultPortalChrome().tagline);
  const [previewLogo, setPreviewLogo] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await sessionApiFetch("/api/settings/portal");
        if (!res.ok) {
          if (!cancelled) setError("Could not load the portal settings.");
          return;
        }
        const body = (await res.json()) as PortalChrome;
        if (cancelled || typeof body?.name !== "string") return;
        applyChrome(body);
      } catch {
        if (!cancelled) setError("Could not load the portal settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyChrome(next: PortalChrome) {
    setChrome(next);
    setName(next.name);
    setTagline(next.tagline);
    setPreviewLogo(next.logoUrl);
  }

  function publish(next: PortalChrome, message: string) {
    applyChrome(next);
    setNote(message);
    setError(null);
    setConfirmReset(false);
    notifyPortalBrandingChanged();
  }

  async function saveText() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await sessionApiFetch("/api/settings/portal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tagline }),
      });
      const body = (await res.json()) as PortalChrome & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not save the portal.");
        return;
      }
      publish(body, "Portal updated for everyone on this install.");
    } catch {
      setError("Could not save the portal.");
    } finally {
      setBusy(false);
    }
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > AVATAR_SOURCE_MAX_BYTES) {
      setError("Choose a JPEG or PNG under 8 MB, then crop the part you want.");
      return;
    }
    const kind = file.type.toLowerCase();
    if (kind && kind !== "image/jpeg" && kind !== "image/png" && kind !== "image/jpg") {
      setError("Use a JPEG or PNG image.");
      return;
    }
    setError(null);
    setNote(null);
    setCropFile(file);
  }

  async function acceptCrop(blob: Blob) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body = new FormData();
      body.append("file", blob, "portal.jpg");
      const res = await sessionApiFetch("/api/settings/portal/logo", {
        method: "PUT",
        body,
      });
      const data = (await res.json()) as PortalChrome & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save the logo.");
        setCropFile(null);
        return;
      }
      setCropFile(null);
      publish(data, "Logo updated. It stays in the same 40×40 slot.");
    } catch {
      setError("Could not save the logo.");
      setCropFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await sessionApiFetch("/api/settings/portal/logo", { method: "DELETE" });
      const data = (await res.json()) as PortalChrome & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not remove the logo.");
        return;
      }
      publish(data, "SecureMind mark restored. The name and phrase are unchanged.");
    } catch {
      setError("Could not remove the logo.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefaults() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await sessionApiFetch("/api/settings/portal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = (await res.json()) as PortalChrome & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not restore the SecureMind portal.");
        return;
      }
      publish(data, "Portal restored to SecureMind.");
    } catch {
      setError("Could not restore the SecureMind portal.");
    } finally {
      setBusy(false);
    }
  }

  const nameLeft = PORTAL_NAME_MAX - name.length;
  const taglineLeft = PORTAL_TAGLINE_MAX - tagline.length;
  const dirty = name !== chrome.name || tagline !== chrome.tagline;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-[var(--shadow-sm)]">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Portal</h3>
        <p className="mt-1 text-[0.75rem] text-muted-foreground leading-relaxed">
          The logo, name, and phrase in the top-left of the workspace. Sign-in, the browser
          title, and email stay SecureMind.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Loading portal…
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-sidebar px-4 py-3 max-w-xs">
            <ProductMark
              src={previewLogo}
              size={40}
              className="size-10 shrink-0 shadow-[0_4px_20px_rgba(99,102,241,0.45)]"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--font-size-body)] font-semibold leading-none text-foreground">
                {name.trim() || "Name"}
              </p>
              {tagline.trim() ? (
                <p className="text-meta mt-1 truncate text-[var(--primary-soft-foreground)]">{tagline.trim()}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              Name
              <input
                value={name}
                maxLength={PORTAL_NAME_MAX}
                onChange={e => setName(e.target.value)}
                className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                autoComplete="off"
              />
              <span className="mt-1 block text-[0.65rem] text-[var(--text-subtle)]">
                {name.length}/{PORTAL_NAME_MAX}
                {nameLeft < 0 ? " — too long" : ""}
              </span>
            </label>
            <label className="block text-xs text-muted-foreground">
              Phrase
              <input
                value={tagline}
                maxLength={PORTAL_TAGLINE_MAX}
                onChange={e => setTagline(e.target.value)}
                placeholder="Leave blank to hide"
                className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                autoComplete="off"
              />
              <span className="mt-1 block text-[0.65rem] text-[var(--text-subtle)]">
                {tagline.length}/{PORTAL_TAGLINE_MAX}
                {taglineLeft < 0 ? " — too long" : ""}
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={e => {
                pickLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left cursor-pointer disabled:opacity-50",
                  chrome.hasCustomLogo
                    ? "border-primary bg-primary/10"
                    : "border-border bg-secondary hover:bg-[var(--surface-hover)]",
                )}
              >
                {chrome.hasCustomLogo ? (
                  <ProductMark src={previewLogo} size={32} className="size-8 shrink-0" />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl border border-dashed border-foreground/25 text-sm text-foreground/40">
                    +
                  </span>
                )}
                <span>
                  <span className="block text-xs font-medium text-foreground">Your logo</span>
                  <span className="block text-[0.65rem] text-[var(--text-subtle)]">JPEG or PNG, cropped square</span>
                </span>
              </button>
              <button
                type="button"
                disabled={busy || !chrome.hasCustomLogo}
                onClick={() => void removeLogo()}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left cursor-pointer disabled:opacity-50",
                  chrome.hasCustomLogo
                    ? "border-border bg-secondary hover:bg-[var(--surface-hover)]"
                    : "border-primary bg-primary/10",
                )}
              >
                <ProductMark size={32} className="size-8 shrink-0" />
                <span>
                  <span className="block text-xs font-medium text-foreground">SecureMind logo</span>
                  <span className="block text-[0.65rem] text-[var(--text-subtle)]">Built in. No file needed.</span>
                </span>
              </button>
            </div>
            <p className="text-[0.65rem] text-[var(--text-subtle)]">
              Shown at 40×40. Switching back uses the logo shipped with the app. A blank phrase hides that line.
            </p>
          </div>

          {(error || note) && (
            <p
              role="status"
              className={error ? "text-[0.75rem] text-destructive" : "text-[0.75rem] text-success"}
            >
              {error ?? note}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.72rem] text-muted-foreground">
                  Restore the SecureMind logo, name, and phrase?
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restoreDefaults()}
                  className="h-8 rounded-lg border border-border px-3 text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  Restore
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmReset(false)}
                  className="h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy || chrome.isDefault}
                onClick={() => setConfirmReset(true)}
                className="h-8 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40"
              >
                Restore SecureMind defaults
              </button>
            )}
            <button
              type="button"
              disabled={busy || !dirty || !name.trim()}
              onClick={() => void saveText()}
              className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save portal"}
            </button>
          </div>
        </>
      )}

      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          title="Crop the portal logo"
          description="Drag to reposition and zoom. The sidebar keeps this as a 40×40 rounded square."
          mask="rounded"
          onCancel={() => setCropFile(null)}
          onAccept={blob => acceptCrop(blob)}
        />
      )}
    </section>
  );
}
