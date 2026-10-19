/**
 * Sensitive-value detection and scrubbing.
 *
 * Used in two places:
 *   - chat composer, client-side, before the message leaves the browser
 *   - document ingest, server-side, before text is persisted or embedded
 *
 * Policy (see AGENTS.md — Sensitive data):
 *   Raw detected values are never persisted, transmitted, or logged. They exist
 *   only in volatile memory during composition. There is no restore path — a
 *   value that was caught is gone, and the user retypes or rephrases if the
 *   detection was wrong.
 *
 * Two controls exist for false positives, both applied BEFORE detection:
 *   1. Sensitivity tier — selects which pattern families run at all.
 *   2. Safe terms       — user-declared values that are known not to be
 *                         sensitive (CIDR ranges, domains, prefixes, literals).
 *
 * Neither control can expose a value after it has been detected.
 */

export type ScrubEvent = {
  category: string;
  count: number;
};

export type MessageSegment =
  | { redacted: false; text: string }
  | { redacted: true; category: string };

/** Aggregate disclosure that a safe term suppressed detections. Carries no values. */
export type SafeTermMatch = {
  termId: string;
  category: string;
  count: number;
};

export type ScrubResult = {
  /** Safe canonical text for storage and model calls. Raw values replaced by typed placeholders. */
  sanitized: string;
  /** Rich segments for display: plain text + opaque redacted blocks. */
  segments: MessageSegment[];
  /** Aggregate counts per category for the trust/security strip. */
  scrubEvents: ScrubEvent[];
  /** Which safe terms suppressed a detection, so exemptions are never silent. */
  safeTermMatches: SafeTermMatch[];
  hadRedactions: boolean;
};

export const SENSITIVITY_TIERS = ["low", "balanced", "high"] as const;
export type PiiSensitivityTier = (typeof SENSITIVITY_TIERS)[number];

/** Stored `extreme` from the former 4-tier scale maps to High. */
export function parsePiiSensitivityTier(v: unknown): PiiSensitivityTier | null {
  if (v === "extreme") return "high";
  if (typeof v === "string" && (SENSITIVITY_TIERS as readonly string[]).includes(v)) {
    return v as PiiSensitivityTier;
  }
  return null;
}

const TIER_ORDER: PiiSensitivityTier[] = [...SENSITIVITY_TIERS];

function tierRank(tier: PiiSensitivityTier): number {
  return TIER_ORDER.indexOf(tier);
}

// ── safe terms ────────────────────────────────────────────────────────────────

export type SafeTermKind =
  | "literal"   // exact string, case-insensitive
  | "cidr"      // IPv4 range, e.g. 10.0.0.0/8
  | "domain"    // domain or suffix, e.g. acme.com or *.internal.acme.com
  | "prefix";   // starts-with, e.g. arn:aws:s3:::acme-logs-*

export type SafeTerm = {
  id: string;
  kind: SafeTermKind;
  value: string;
  /** Optional human note explaining why this was declared safe. */
  label?: string;
};

/**
 * RFC 2606 / RFC 6761 documentation names. These are not real people or
 * routable mail — they ship as Safe terms so demos and docs are not flagged
 * as email detections. Listed in Settings so the exemption is visible.
 */
export const DOCUMENTATION_MAIL_DOMAINS = ["example.com", "example.org", "example.net"] as const;
export const DOCUMENTATION_MAIL_TLDS = ["test", "invalid", "localhost", "example"] as const;

function normalizeDomainValue(value: string): string {
  return value.trim().toLowerCase().replace(/^\*\./, "");
}

export function isDocumentationMailDomain(value: string): boolean {
  const v = normalizeDomainValue(value);
  return (DOCUMENTATION_MAIL_DOMAINS as readonly string[]).includes(v)
    || (DOCUMENTATION_MAIL_TLDS as readonly string[]).includes(v);
}

/** Shipped catalog entries (`id` starts with `default-`). Visible and removable. */
export function isShippedDefaultSafeTerm(term: Pick<SafeTerm, "id">): boolean {
  return term.id.startsWith("default-");
}

/** @deprecated No terms are retired; kept so stored lists are not rewritten. */
export function omitRetiredDefaultSafeTerms(terms: SafeTerm[]): SafeTerm[] {
  return terms;
}

/**
 * Shipped defaults. Non-routable address space and documentation mailboxes are
 * not identifying. These are ordinary editable entries — visible in Safe terms
 * so a demo can show why `*@example.com` is not treated as a person.
 */
export const DEFAULT_SAFE_TERMS: SafeTerm[] = [
  { id: "default-example-com", kind: "domain", value: "example.com", label: "RFC 2606 documentation domain — not a real mailbox" },
  { id: "default-example-org", kind: "domain", value: "example.org", label: "RFC 2606 documentation domain — not a real mailbox" },
  { id: "default-example-net", kind: "domain", value: "example.net", label: "RFC 2606 documentation domain — not a real mailbox" },
  { id: "default-tld-test", kind: "domain", value: "test", label: "Reserved TLD (.test) — documentation / synthetic" },
  { id: "default-tld-invalid", kind: "domain", value: "invalid", label: "Reserved TLD (.invalid) — documentation / synthetic" },
  { id: "default-tld-localhost", kind: "domain", value: "localhost", label: "Reserved TLD (.localhost) — documentation / synthetic" },
  { id: "default-tld-example", kind: "domain", value: "example", label: "Reserved TLD (.example) — documentation / synthetic" },
  { id: "default-rfc1918-10",  kind: "cidr", value: "10.0.0.0/8",     label: "RFC 1918 private range" },
  { id: "default-rfc1918-172", kind: "cidr", value: "172.16.0.0/12",  label: "RFC 1918 private range" },
  { id: "default-rfc1918-192", kind: "cidr", value: "192.168.0.0/16", label: "RFC 1918 private range" },
  { id: "default-loopback",    kind: "cidr", value: "127.0.0.0/8",    label: "Loopback" },
  { id: "default-linklocal",   kind: "cidr", value: "169.254.0.0/16", label: "Link-local" },
  { id: "default-doc-192",     kind: "cidr", value: "192.0.2.0/24",   label: "RFC 5737 documentation range" },
  { id: "default-doc-198",     kind: "cidr", value: "198.51.100.0/24",label: "RFC 5737 documentation range" },
  { id: "default-doc-203",     kind: "cidr", value: "203.0.113.0/24", label: "RFC 5737 documentation range" },
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

/** True when `ip` falls inside `cidr`. Returns false for malformed input. */
export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const baseInt = ipv4ToInt(base);
  const ipInt   = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null) return false;

  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

/** Normalizes `*.acme.com`, `.acme.com`, `@acme.com` → `acme.com`. */
function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\*?\.?/, "").replace(/^@/, "");
}

function matchesDomain(term: string, matched: string): boolean {
  const domain = normalizeDomain(term);
  if (!domain) return false;
  const hay = matched.trim().toLowerCase();
  if (hay === domain) return true;
  // Must sit on a label or local-part boundary so "notacme.com" fails against "acme.com".
  return hay.endsWith(`.${domain}`) || hay.endsWith(`@${domain}`);
}

/** True when any safe term covers this matched value. */
export function isSafeTerm(matched: string, safeTerms: SafeTerm[]): SafeTerm | null {
  const hay = matched.trim();
  for (const term of safeTerms) {
    switch (term.kind) {
      case "literal":
        if (hay.toLowerCase() === term.value.trim().toLowerCase()) return term;
        break;
      case "cidr":
        if (cidrContains(term.value, hay)) return term;
        break;
      case "domain":
        if (matchesDomain(term.value, hay)) return term;
        break;
      case "prefix": {
        const prefix = term.value.replace(/\*+$/, "").toLowerCase();
        if (prefix && hay.toLowerCase().startsWith(prefix)) return term;
        break;
      }
    }
  }
  return null;
}

// ── patterns ──────────────────────────────────────────────────────────────────

type PatternDef = {
  category: string;
  label: string;
  pattern: RegExp;
  /** Lowest sensitivity tier at which this family runs. */
  minTier: PiiSensitivityTier;
  /** Secondary check to suppress structurally invalid matches. */
  validate?: (matched: string) => boolean;
  /**
   * Whether a safe term may exempt this category. False for small-value-space,
   * high-consequence categories — allowlisting an SSN is never a valid decision.
   */
  exemptible: boolean;
};

/** Luhn checksum — rejects digit runs that cannot be real card numbers. */
export function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Canadian SIN check digit (mod-10 / Luhn-style from the left).
 * Rejects all-zero / all-identical runs to cut obvious false positives.
 */
export function passesCanadianSin(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  if (/^0{9}$/.test(digits) || /^(\d)\1{8}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const PATTERNS: PatternDef[] = [
  {
    category: "email",
    label: "Email addresses",
    minTier: "low",
    exemptible: true,
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    category: "SSN",
    label: "Social Security numbers",
    minTier: "low",
    exemptible: false,
    // US AAA-GG-SSSS — middle group is exactly 2 digits (not Canadian 3-3-3).
    pattern: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
  },
  {
    category: "SIN",
    label: "Social Insurance numbers",
    minTier: "low",
    exemptible: false,
    // Canadian 3-3-3 with hyphen/space, or a bare 9-digit run. Checksum required.
    // Does not match US SSN (3-2-4) because the middle group here is 3 digits.
    pattern: /\b\d{3}[- ]\d{3}[- ]\d{3}\b|(?<!\d)\d{9}(?!\d)/g,
    validate: passesCanadianSin,
  },
  {
    category: "card number",
    label: "Credit / debit card numbers",
    minTier: "low",
    exemptible: false,
    // Broad shape, then Luhn. Without the checksum this matched any 13–19 digit
    // run, which fires constantly on trace IDs and request IDs in log excerpts.
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: passesLuhn,
  },
  {
    category: "phone",
    label: "Phone numbers",
    minTier: "balanced",
    exemptible: true,
    // NANP-shaped. Area code in the bare branch cannot start with 0/1, which
    // avoids matching arbitrary 10-digit identifiers.
    pattern:
      /(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]?\d{4}\b|(?<!\d)[2-9]\d{2}\d{3}\d{4}(?!\d)/g,
  },
  {
    category: "IP address",
    label: "IPv4 addresses",
    minTier: "balanced",
    exemptible: true,
    pattern: /\b(?:(?:25[0-5]|2\d\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2\d\d|1\d\d|[1-9]?\d)\b/g,
  },
  {
    category: "address",
    label: "Street addresses",
    minTier: "balanced",
    exemptible: true,
    pattern:
      /\b(?<!\.)\d{1,5}[ \t]+[A-Za-z][\w.\x27-]*(?:[ \t]+[\w.\x27-]+){0,5}[ \t]+(?:street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|place|pl|way|parkway|pkwy)\b/gi,
  },
  {
    category: "ID number",
    label: "Passport / national ID patterns",
    minTier: "high",
    exemptible: true,
    pattern: /\b[A-Z]{1,2}[0-9]{7,9}\b/g,
  },
  // Secrets are hard-blocked: always scanned (minTier low) and never safe-listable.
  {
    category: "secret",
    label: "API keys & secrets",
    minTier: "low",
    exemptible: false,
    // High-signal credential shapes — prefer known prefixes / named assignments
    // over generic entropy (a bare 40-char string is too noisy alone).
    pattern:
      /(?:-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----)|(?:\b(?:sk_live_|sk_test_|rk_live_|rk_test_)[A-Za-z0-9]{16,}\b)|(?:\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{20,}\b)|(?:\bgithub_pat_[A-Za-z0-9_]{20,}\b)|(?:\bxox[baprs]-[A-Za-z0-9-]{10,}\b)|(?:\b(?:AKIA|ASIA)[0-9A-Z]{16}\b)|(?:"?aws_secret_access_key"?|"?AWS_SECRET_ACCESS_KEY"?|"?SecretAccessKey"?)\s*[=:]\s*"?[A-Za-z0-9/+=]{40}\b|(?:"?aws_session_token"?|"?AWS_SESSION_TOKEN"?|"?SessionToken"?)\s*[=:]\s*"?[A-Za-z0-9/+=]{100,}|(?:\b(?:sk-|sk-proj-)[A-Za-z0-9_-]{20,}\b)|(?:\bAIza[0-9A-Za-z_-]{35}\b)/g,
  },
];

/** Human-readable catalog — shown in the Security panel. */
export const PII_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PATTERNS.map(p => [p.category, p.label]),
);

/** Categories that a safe term may never exempt. */
export const NON_EXEMPTIBLE_CATEGORIES: string[] = PATTERNS
  .filter(p => !p.exemptible)
  .map(p => p.category);

export const DEFAULT_SENSITIVITY: PiiSensitivityTier = "balanced";

export const SENSITIVITY_TIER_LABELS: Record<PiiSensitivityTier, string> = {
  low: "Low",
  balanced: "Balanced",
  high: "High",
};

export type PiiPatternPublic = {
  category: string;
  label: string;
  minTier: PiiSensitivityTier;
  exemptible: boolean;
};

/** Catalog for Settings / Insights — no regexes. Ordered by min tier, then label. */
export function piiPatternCatalog(): PiiPatternPublic[] {
  return PATTERNS.map(p => ({
    category: p.category,
    label: p.label,
    minTier: p.minTier,
    exemptible: p.exemptible,
  }));
}

/** Categories whose family starts at this tier (not cumulative). */
export function categoriesAddedAtTier(tier: PiiSensitivityTier): string[] {
  return PATTERNS.filter(p => p.minTier === tier).map(p => p.label);
}

/** Map a 0–1 UI slider value to a tier. */
export function sensitivityTier(sensitivity: number): PiiSensitivityTier {
  if (sensitivity <= 0.25) return "low";
  if (sensitivity <= 0.60) return "balanced";
  return "high";
}

function patternsForTier(tier: PiiSensitivityTier): PatternDef[] {
  const rank = tierRank(tier);
  return PATTERNS.filter(p => tierRank(p.minTier) <= rank);
}

/** Category labels active at a given tier — used for Security panel copy. */
export function categoriesForTier(tier: PiiSensitivityTier): string[] {
  return patternsForTier(tier).map(p => p.label);
}

/** Human-readable label for a category key (e.g. "phone" → "Phone numbers"). */
export function categoryLabel(category: string): string {
  return PII_CATEGORY_LABELS[category] ?? category;
}

/** Every category the scrubber knows about, regardless of tier. */
export function allScannedCategories(): string[] {
  return PATTERNS.map(p => p.label);
}

/**
 * Validates a proposed safe term before it is saved.
 *
 * Rejects anything that looks like a non-exemptible category, so the safe-terms
 * list cannot become a side channel for storing an SSN, card number, or secret.
 */
export function validateSafeTerm(
  value: string,
  kind: SafeTermKind,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: "Enter a value." };
  if (trimmed.length > 200) return { ok: false, reason: "Value is too long." };

  if (kind === "cidr" && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(trimmed)) {
    return { ok: false, reason: "Expected CIDR notation, for example 10.0.0.0/8." };
  }
  if (kind === "cidr" && !cidrContains(trimmed, trimmed.split("/")[0])) {
    return { ok: false, reason: "Not a valid IPv4 range." };
  }

  for (const def of PATTERNS.filter(p => !p.exemptible)) {
    def.pattern.lastIndex = 0;
    const hit = def.pattern.exec(trimmed);
    def.pattern.lastIndex = 0;
    if (hit && (!def.validate || def.validate(hit[0]))) {
      return {
        ok: false,
        reason: `This looks like a ${categoryLabel(def.category).toLowerCase()} value, which can never be added to the safe list.`,
      };
    }
  }

  return { ok: true };
}

// ── scrubbing ─────────────────────────────────────────────────────────────────

type RawMatch = { start: number; end: number; category: string };

export type ScrubOptions = {
  /** 0–1 slider value, or an explicit tier. Defaults to "balanced". */
  sensitivity?: number | PiiSensitivityTier | "extreme";
  /** User-declared values that should not be treated as sensitive. */
  safeTerms?: SafeTerm[];
  /** Only run these categories (server-side gate). Omit to run every category for the tier. */
  onlyCategories?: readonly string[];
};

function resolveTier(sensitivity: ScrubOptions["sensitivity"]): PiiSensitivityTier {
  if (sensitivity === undefined) return DEFAULT_SENSITIVITY;
  if (typeof sensitivity === "number") return sensitivityTier(sensitivity);
  return parsePiiSensitivityTier(sensitivity) ?? DEFAULT_SENSITIVITY;
}

/**
 * Scrub sensitive values from text.
 *
 * The returned `sanitized` string is the only form that may be persisted,
 * transmitted, or logged. `segments` is for rendering and holds no redacted
 * values — a redacted span carries its category and nothing else.
 */
export function scrubPII(text: string, options: ScrubOptions = {}): ScrubResult {
  const tier      = resolveTier(options.sensitivity);
  const safeTerms = options.safeTerms ?? [];
  const only      = options.onlyCategories;
  const patterns  = patternsForTier(tier).filter(p => !only || only.includes(p.category));

  const allMatches: RawMatch[] = [];
  const safeHits = new Map<string, SafeTermMatch>();

  for (const def of patterns) {
    def.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = def.pattern.exec(text)) !== null) {
      const value = match[0];

      // Zero-length matches would loop forever.
      if (value.length === 0) {
        def.pattern.lastIndex++;
        continue;
      }

      if (def.validate && !def.validate(value)) continue;

      if (def.exemptible) {
        const term = isSafeTerm(value, safeTerms);
        if (term) {
          const key = `${term.id}:${def.category}`;
          const prev = safeHits.get(key);
          if (prev) prev.count++;
          else safeHits.set(key, { termId: term.id, category: def.category, count: 1 });
          continue;
        }
      }

      allMatches.push({
        start: match.index,
        end: match.index + value.length,
        category: def.category,
      });
    }
  }

  const safeTermMatches = [...safeHits.values()];

  if (allMatches.length === 0) {
    return {
      sanitized: text,
      segments: [{ redacted: false, text }],
      scrubEvents: [],
      safeTermMatches,
      hadRedactions: false,
    };
  }

  // Sort by position, then merge overlapping ranges.
  allMatches.sort((a, b) => (a.start - b.start) || (b.end - a.end));
  const merged: RawMatch[] = [];
  for (const m of allMatches) {
    const prev = merged[merged.length - 1];
    if (prev && m.start < prev.end) {
      prev.end = Math.max(prev.end, m.end);
    } else {
      merged.push({ ...m });
    }
  }

  const segments: MessageSegment[] = [];
  let sanitized = "";
  let cursor = 0;

  for (const { start, end, category } of merged) {
    if (start > cursor) {
      const plain = text.slice(cursor, start);
      segments.push({ redacted: false, text: plain });
      sanitized += plain;
    }
    segments.push({ redacted: true, category });
    sanitized += `[${category} redacted]`;
    cursor = end;
  }

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    segments.push({ redacted: false, text: tail });
    sanitized += tail;
  }

  const eventMap = new Map<string, number>();
  for (const { category } of merged) {
    eventMap.set(category, (eventMap.get(category) ?? 0) + 1);
  }
  const scrubEvents: ScrubEvent[] = Array.from(eventMap, ([category, count]) => ({
    category,
    count,
  }));

  return { sanitized, segments, scrubEvents, safeTermMatches, hadRedactions: true };
}
