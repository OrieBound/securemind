"use client";

import { useEffect, useState } from "react";
import { ProductMark } from "@/components/app/product-mark";
import { sessionApiFetch } from "@/lib/client/api-base";
import { PORTAL_BRANDING_EVENT } from "@/lib/portal-branding-events";
import { defaultPortalChrome, type PortalChrome } from "@/lib/portal-branding-shared";

/** Top-left portal mark. SecureMind until the instance record loads. */
export function PortalBrandMark() {
  const [brand, setBrand] = useState<PortalChrome>(defaultPortalChrome);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await sessionApiFetch("/api/settings/portal");
        if (!res.ok) return;
        const body = (await res.json()) as PortalChrome;
        if (cancelled || typeof body?.name !== "string") return;
        setBrand(body);
        setLogoFailed(false);
      } catch {
        /* keep the SecureMind mark */
      }
    }
    void load();
    const onChange = () => void load();
    window.addEventListener(PORTAL_BRANDING_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(PORTAL_BRANDING_EVENT, onChange);
    };
  }, []);

  return (
    <>
      <ProductMark
        src={logoFailed ? null : brand.logoUrl}
        onError={() => setLogoFailed(true)}
        size={40}
        className="size-10 shrink-0 shadow-[0_4px_20px_rgba(99,102,241,0.45)]"
      />
      <div className="min-w-0">
        <p
          className="truncate text-[length:var(--font-size-body)] font-semibold text-foreground leading-none tracking-[var(--tracking-ui)]"
          title={brand.name}
        >
          {brand.name}
        </p>
        {brand.tagline ? (
          <p className="text-meta mt-1 truncate text-[var(--primary-soft-foreground)]" title={brand.tagline}>
            {brand.tagline}
          </p>
        ) : null}
      </div>
    </>
  );
}
