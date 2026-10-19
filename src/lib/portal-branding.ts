/**
 * Admin-owned sidebar portal (logo, name, phrase).
 *
 * Text lives on InstanceConfig: Postgres locally, the hosted Dynamo config row
 * in the cloud. Logo bytes follow profile photos — disk locally, private S3
 * when AVATAR_S3_BUCKET is set.
 */

import type { AvatarImageKind } from "@/lib/avatar-image";
import { db } from "@/lib/db";
import { ensureInstanceConfig, getInstanceConfig } from "@/lib/instance-config";
import { hostedInstanceConfig } from "@/lib/instance-config-hosted";
import { removePortalLogo, writePortalLogo } from "@/lib/portal-logo-storage";
import { toPortalChrome, type PortalChrome } from "@/lib/portal-branding-shared";
import { isHostedRuntime } from "@/lib/runtime-env";

export async function readPortalChrome(): Promise<PortalChrome> {
  try {
    return toPortalChrome(await getInstanceConfig());
  } catch {
    return toPortalChrome(null);
  }
}

async function persist(partial: {
  portalName?: string | null;
  portalTagline?: string | null;
  portalLogoAt?: Date | null;
  updatedByUserId: string;
}): Promise<PortalChrome> {
  await ensureInstanceConfig();
  if (isHostedRuntime()) {
    await hostedInstanceConfig().merge(partial);
  } else {
    await db.instanceConfig.update({
      where: { id: "singleton" },
      data: partial,
    });
  }
  return toPortalChrome(await getInstanceConfig());
}

export async function savePortalText(
  userId: string,
  name: string,
  tagline: string,
): Promise<PortalChrome> {
  return persist({
    portalName: name,
    portalTagline: tagline,
    updatedByUserId: userId,
  });
}

export async function savePortalLogo(
  userId: string,
  bytes: Buffer,
  contentType: AvatarImageKind,
): Promise<PortalChrome> {
  const meta = await writePortalLogo(bytes, contentType);
  const at = new Date(meta.updatedAt);
  return persist({
    portalLogoAt: Number.isNaN(at.getTime()) ? new Date() : at,
    updatedByUserId: userId,
  });
}

export async function clearPortalLogo(userId: string): Promise<PortalChrome> {
  await removePortalLogo();
  return persist({ portalLogoAt: null, updatedByUserId: userId });
}

export async function resetPortalBranding(userId: string): Promise<PortalChrome> {
  await removePortalLogo();
  return persist({
    portalName: null,
    portalTagline: null,
    portalLogoAt: null,
    updatedByUserId: userId,
  });
}
