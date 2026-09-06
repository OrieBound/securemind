export type SecurityHash =
  | { kind: "log" }
  | { kind: "policy" }
  | { kind: "charts" }
  | { kind: "record"; recordId: string };

const SECTION_IDS: Record<string, Exclude<SecurityHash, { kind: "record" }>> = {
  "detection-log": { kind: "log" },
  "detection-policy": { kind: "policy" },
  "security-charts": { kind: "charts" },
};

export function parseSecurityHash(hash: string): SecurityHash | null {
  const raw = hash.replace(/^#/, "");
  if (SECTION_IDS[raw]) return SECTION_IDS[raw];
  if (raw.startsWith("pii-record-")) {
    const recordId = raw.slice("pii-record-".length);
    return recordId ? { kind: "record", recordId } : null;
  }
  return null;
}
