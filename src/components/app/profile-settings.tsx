"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVATAR_PRESETS } from "@/lib/avatar-presets";
import { AVATAR_SOURCE_MAX_BYTES } from "@/lib/avatar-crop";
import type { UserProfilePublic } from "@/lib/user-profile";
import { useAuthSession } from "@/components/app/auth-session";
import { notifyAvatarChanged, UserAvatarFace } from "@/components/app/user-avatar";
import { AvatarCropDialog } from "@/components/app/avatar-crop-dialog";
import type { DirectoryPasswordPolicy } from "@/lib/auth-password";

type WorkspaceBrief = { id: string; name: string; emoji: string; isDefault: boolean };

type SecurityInfo = {
  authMode: string;
  role: string;
  passwordChangeAvailable: boolean;
  note: string;
  lastSignInAt: string | null;
  accountCreatedAt: string;
  status: string;
  mfaStatus: string;
  sessions: string;
  passwordPolicy?: DirectoryPasswordPolicy;
};

export function ProfileAvatarBadge({
  presetId,
  displayName,
  email,
  photoUrl = null,
}: {
  presetId: string;
  displayName: string | null;
  email: string | null;
  photoUrl?: string | null;
}) {
  return (
    <UserAvatarFace
      presetId={presetId}
      displayName={displayName}
      email={email}
      photoUrl={photoUrl}
      size="sm"
    />
  );
}

export function ProfileSettings() {
  const authSession = useAuthSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfilePublic | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceBrief[]>([]);
  const [security, setSecurity] = useState<SecurityInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("");
  const [avatarPreset, setAvatarPreset] = useState("shield");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [themePreference, setThemePreference] = useState<string>("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/me/profile", { credentials: "same-origin" }),
        fetch("/api/me/security", { credentials: "same-origin" }),
      ]);
      if (pRes.status === 401) {
        setLoadError("Your sign-in expired. Sign in again to open your profile.");
        await authSession?.logout("Your sign-in expired. Sign in again.");
        return;
      }
      if (!pRes.ok) {
        setLoadError("Could not load profile.");
        return;
      }
      const pBody = (await pRes.json()) as {
        profile: UserProfilePublic;
        role: string;
        workspaces: WorkspaceBrief[];
      };
      setProfile(pBody.profile);
      setRole(pBody.role);
      setWorkspaces(pBody.workspaces ?? []);
      setDisplayName(pBody.profile.displayName ?? "");
      setHandle(pBody.profile.handle ?? "");
      setJobTitle(pBody.profile.jobTitle ?? "");
      setBio(pBody.profile.bio ?? "");
      setTimezone(pBody.profile.timezone ?? "");
      setAvatarPreset(pBody.profile.avatarPreset);
      setPhotoUrl(pBody.profile.avatarUrl);
      setThemePreference(pBody.profile.themePreference ?? "");
      setDirty(false);
      if (sRes.ok) setSecurity((await sRes.json()) as SecurityInfo);
    } catch {
      setLoadError("Could not load profile.");
    } finally {
      setLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName || null,
          handle: handle || null,
          jobTitle: jobTitle || null,
          bio: bio || null,
          timezone: timezone || null,
          avatarPreset,
          themePreference: themePreference || null,
        }),
      });
      const data = (await res.json()) as { error?: string; profile?: UserProfilePublic };
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      if (data.profile) {
        setProfile(data.profile);
        setPhotoUrl(data.profile.avatarUrl);
      }
      setDirty(false);
      setNotice("Profile saved.");
      notifyAvatarChanged();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function pickPhoto(file: File | undefined) {
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
    setNotice(null);
    setCropFile(file);
  }

  async function acceptCrop(blob: Blob) {
    const previousUrl = photoUrl;
    setPhotoBusy(true);
    setNotice(null);
    setError(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const preview = URL.createObjectURL(blob);
    previewUrlRef.current = preview;
    setPhotoUrl(preview);
    setCropFile(null);
    const dropPreview = () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPhotoUrl(previousUrl);
    };
    try {
      const body = new FormData();
      body.append("file", blob, "avatar.jpg");
      const res = await fetch("/api/me/avatar", {
        method: "PUT",
        credentials: "same-origin",
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; avatarUrl?: string };
      if (!res.ok) {
        dropPreview();
        setError(data.error ?? "Could not save that photo.");
        return;
      }
      const next = data.avatarUrl ?? `/api/me/avatar?v=${Date.now()}`;
      setPhotoUrl(next);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setNotice("Photo saved. It shows here and in the header.");
      notifyAvatarChanged();
    } catch {
      dropPreview();
      setError("Could not save that photo.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearPhoto() {
    setPhotoBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/me/avatar", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError("Could not remove the photo.");
        return;
      }
      setPhotoUrl(null);
      notifyAvatarChanged();
    } catch {
      setError("Could not remove the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Password change failed");
        return;
      }
      setNotice(data.message ?? "Password updated. Sign in again.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await authSession?.logout();
    } catch {
      setError("Network error");
    } finally {
      setPwBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground/40 py-8">
        <Loader2 className="size-4 animate-spin" />
        Loading profile…
      </div>
    );
  }

  if (loadError || !profile || !role) {
    return (
      <div className="space-y-3 py-6 max-w-md">
        <p className="text-sm text-red-200/90" role="alert">
          {loadError ?? "Could not load profile."}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-foreground/15 px-3 py-1.5 text-[0.72rem] cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {(notice || error) && (
        <p
          role="status"
          className={cn(
            "text-[0.75rem] rounded-lg border px-3 py-2",
            error
              ? "border-red-500/30 bg-red-500/10 text-red-200/90"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200/90",
          )}
        >
          {error ?? notice}
        </p>
      )}

      {/* Profile information */}
      <section className="space-y-4">
        <div>
          <h3 className="text-section">Profile information</h3>
          <p className="text-xs text-foreground/35 mt-1">
            How you appear in SecureMind. Your sign-in email cannot be changed here.
          </p>
        </div>

        <form onSubmit={saveProfile} className="space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatarFace
              presetId={avatarPreset}
              displayName={displayName}
              email={profile.email}
              photoUrl={photoUrl}
              size="xl"
            />
            <div className="min-w-0">
              <p className="text-sm text-foreground/80 truncate">
                {displayName || profile.email || "Your profile"}
              </p>
              <p className="text-[0.65rem] text-foreground/35 truncate">{profile.email ?? "—"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                  className="sr-only"
                  onChange={e => {
                    pickPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-foreground/15 px-2.5 py-1 text-[0.68rem] cursor-pointer disabled:opacity-40"
                >
                  {photoBusy ? "Saving…" : photoUrl ? "Change photo" : "Upload photo"}
                </button>
                {photoUrl && (
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={() => void clearPhoto()}
                    className="rounded-lg border border-foreground/10 px-2.5 py-1 text-[0.68rem] text-foreground/55 cursor-pointer disabled:opacity-40"
                  >
                    Use a preset instead
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-[0.62rem] text-foreground/35 leading-relaxed">
                JPEG or PNG, up to 8 MB. You crop a square before it is saved. It replaces the
                glyph here and in the header.
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-foreground/45 mb-2">Avatar preset</p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (photoUrl) {
                      setNotice("Remove the photo first if you want a glyph instead.");
                      return;
                    }
                    setAvatarPreset(p.id);
                    setDirty(true);
                  }}
                  aria-pressed={!photoUrl && avatarPreset === p.id}
                  aria-label={p.label}
                  className={cn(
                    "size-10 rounded-full border text-base transition-colors cursor-pointer",
                    photoUrl && "opacity-40",
                    !photoUrl && avatarPreset === p.id
                      ? "border-indigo-400/60 ring-2 ring-indigo-400/30"
                      : "border-foreground/10 hover:border-foreground/25",
                  )}
                  style={{ backgroundColor: `${p.color}33` }}
                >
                  {p.glyph}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Display name</span>
            <input
              value={displayName}
              onChange={e => {
                setDisplayName(e.target.value);
                setDirty(true);
              }}
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
              maxLength={80}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Handle</span>
            <input
              value={handle}
              onChange={e => {
                setHandle(e.target.value);
                setDirty(true);
              }}
              placeholder="optional-unique-handle"
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm font-mono"
              maxLength={32}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Job title</span>
            <input
              value={jobTitle}
              onChange={e => {
                setJobTitle(e.target.value);
                setDirty(true);
              }}
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
              maxLength={80}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Bio</span>
            <textarea
              value={bio}
              onChange={e => {
                setBio(e.target.value);
                setDirty(true);
              }}
              rows={3}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2 text-sm resize-y"
              maxLength={500}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Timezone</span>
            <input
              value={timezone}
              onChange={e => {
                setTimezone(e.target.value);
                setDirty(true);
              }}
              placeholder="e.g. America/Toronto"
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={saving || !dirty}
            className="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-4 py-2 text-[0.75rem] font-medium text-indigo-100 disabled:opacity-40 cursor-pointer"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
          {dirty && (
            <p className="text-[0.65rem] text-amber-200/70">You have unsaved changes.</p>
          )}
        </form>
      </section>

      {/* Account information (read-only) */}
      <section className="space-y-3 rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-4">
        <h3 className="text-section">Account information</h3>
        <dl className="grid gap-2 text-[0.75rem]">
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/40">Role</dt>
            <dd className="text-foreground/75 capitalize">{role}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/40">Status</dt>
            <dd className="text-foreground/75 capitalize">{profile.status}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/40">Email</dt>
            <dd className="text-foreground/75 truncate">{profile.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/40">Joined</dt>
            <dd className="text-foreground/75">
              {new Date(profile.createdAt).toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/40">Last sign-in</dt>
            <dd className="text-foreground/75">
              {profile.lastSignInAt
                ? new Date(profile.lastSignInAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/40">Auth</dt>
            <dd className="text-foreground/75">{security?.authMode ?? "—"}</dd>
          </div>
        </dl>
        {(role === "super_admin" || role === "admin") && (
          <p className="text-[0.65rem] text-foreground/35 pt-1">
            You have elevated access. User management lives in Settings → Admin console, not here.
          </p>
        )}
        {workspaces.length > 0 && (
          <div className="pt-2 border-t border-foreground/[0.06]">
            <p className="text-[0.65rem] text-foreground/40 mb-1.5">Your workspaces</p>
            <ul className="space-y-1">
              {workspaces.map(w => (
                <li key={w.id} className="text-[0.75rem] text-foreground/65">
                  {w.emoji} {w.name}
                  {w.isDefault ? " (default)" : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Preferences */}
      <section className="space-y-3">
        <h3 className="text-section">Preferences</h3>
        <label className="block space-y-1">
          <span className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Theme preference</span>
          <select
            value={themePreference}
            onChange={e => {
              setThemePreference(e.target.value);
              setDirty(true);
            }}
            className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
          >
            <option value="">Use device setting</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </label>
        <p className="text-[0.65rem] text-foreground/30">
          Appearance also has a quick toggle. Workspace detection policy is Admin-owned under Settings → Workspace.
        </p>
      </section>

      {/* Security */}
      <section className="space-y-3">
        <h3 className="text-section">Security</h3>
        <p className="text-xs text-foreground/40">{security?.note}</p>
        {security?.passwordChangeAvailable ? (
          <form onSubmit={changePassword} className="space-y-2.5 max-w-md">
            <p className="text-[0.65rem] text-foreground/35">
              {security.passwordPolicy?.summary
                ?? "Cognito password policy applies."}{" "}
              You will be signed out after a successful change.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
              required
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
              required
              minLength={security.passwordPolicy?.minLength ?? 8}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
              required
              minLength={security.passwordPolicy?.minLength ?? 8}
            />
            <button
              type="submit"
              disabled={pwBusy}
              className="rounded-lg border border-foreground/15 px-3 py-2 text-[0.72rem] cursor-pointer disabled:opacity-40"
            >
              {pwBusy ? "Updating…" : "Change password"}
            </button>
          </form>
        ) : (
          <p className="text-[0.7rem] text-foreground/35">
            MFA and multi-device session lists are not available from Cognito in this build.
          </p>
        )}
        {authSession && (
          <button
            type="button"
            onClick={() => void authSession.logout()}
            className="rounded-lg border border-foreground/15 px-3 py-2 text-[0.72rem] text-foreground/60 cursor-pointer"
          >
            Sign out of this session
          </button>
        )}
      </section>

      {/* Privacy */}
      <section className="space-y-2 rounded-2xl border border-foreground/[0.07] px-4 py-4">
        <h3 className="text-section">Privacy & lifecycle</h3>
        <p className="text-[0.7rem] text-foreground/40 leading-relaxed">
          Account deletion is performed by an Administrator (they turn off sign-in; data
          stays until a future purge). Contact an Admin if you need your account closed.
        </p>
        <ul className="text-[0.7rem] text-foreground/35 space-y-1 list-disc pl-4">
          <li>Privacy Policy (placeholder)</li>
          <li>Terms of Service (placeholder)</li>
          <li>Security and Data Handling (placeholder)</li>
        </ul>
      </section>
      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          onCancel={() => {
            setCropFile(null);
            if (fileRef.current) fileRef.current.value = "";
          }}
          onAccept={blob => acceptCrop(blob)}
        />
      )}
    </div>
  );
}
