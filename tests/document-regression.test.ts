/**
 * Synthetic document regression: extract every supported test-file type,
 * detect per instance policy, keep surrounding structure, and keep raw
 * secrets off the model boundary and out of audit events.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { extractDocument } from "@/lib/documents";
import { DEFAULT_SAFE_TERMS, DEFAULT_SENSITIVITY, scrubPII } from "@/lib/pii";
import {
  MUST_PRESERVE_BALANCED,
  MUST_REDACT_BALANCED,
  SYNTH,
} from "@/lib/regression/corpus";

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      userId: "local",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    }),
  };
});

const TEST_FILES_DIR = join(process.cwd(), "docs", "test-files");

const TEST_FILES: { name: string; mime: string }[] = [
  {
    name: "customer-case.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { name: "service-agreement.pdf", mime: "application/pdf" },
  {
    name: "employee-register.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  { name: "support-tickets.csv", mime: "text/csv" },
  { name: "incident-notes.txt", mime: "text/plain" },
  { name: "app-config.json", mime: "application/json" },
  {
    name: "SecureMind_Synthetic_Utility_Invoice.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
];

function loadTestFiles() {
  return TEST_FILES.map(f => ({
    ...f,
    buffer: readFileSync(join(TEST_FILES_DIR, f.name)),
  }));
}

function scrubExtracted(text: string) {
  return scrubPII(text, {
    sensitivity: DEFAULT_SENSITIVITY,
    safeTerms: DEFAULT_SAFE_TERMS,
  });
}

describe("synthetic document regression corpus", () => {
  it("extracts every test-file type with readable text", async () => {
    const files = loadTestFiles();
    expect(files.map(f => f.name)).toEqual([
      "customer-case.docx",
      "service-agreement.pdf",
      "employee-register.xlsx",
      "support-tickets.csv",
      "incident-notes.txt",
      "app-config.json",
      "SecureMind_Synthetic_Utility_Invoice.docx",
    ]);

    for (const file of files) {
      let extracted;
      try {
        extracted = await extractDocument(file.buffer, file.mime, file.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${file.name}: ${message}`);
      }
      expect(extracted.text.trim().length, file.name).toBeGreaterThan(20);
      expect(extracted.text, file.name).toContain(SYNTH.email);
    }
  });

  it("redacts policy hits without destroying surrounding structure", async () => {
    const files = loadTestFiles();
    for (const file of files) {
      const extracted = await extractDocument(file.buffer, file.mime, file.name);
      const scrubbed = scrubExtracted(extracted.text);

      for (const raw of MUST_REDACT_BALANCED) {
        if (extracted.text.includes(raw)) {
          expect(scrubbed.sanitized, `${file.name} still contains ${raw}`).not.toContain(raw);
        }
      }

      expect(scrubbed.sanitized).toContain(SYNTH.controlProse);
      expect(scrubbed.sanitized).toContain(SYNTH.ticketId);
      expect(scrubbed.hadRedactions).toBe(true);

      if (file.name === "app-config.json") {
        expect(scrubbed.sanitized).toContain('"app"');
        expect(scrubbed.sanitized).toContain('"user"');
        expect(scrubbed.sanitized).toContain("[email redacted]");
        expect(scrubbed.sanitized).toContain("[SSN redacted]");
      }
    }
  });

  it("redacts the same email consistently when it is repeated", async () => {
    const files = loadTestFiles();
    const docx = files.find(f => f.name === "customer-case.docx")!;
    const extracted = await extractDocument(docx.buffer, docx.mime, docx.name);
    const matches = extracted.text.split(SYNTH.email).length - 1;
    expect(matches).toBeGreaterThanOrEqual(2);
    const scrubbed = scrubExtracted(extracted.text);
    expect(scrubbed.sanitized).not.toContain(SYNTH.email);
    const placeholders = scrubbed.sanitized.match(/\[email redacted\]/g) ?? [];
    expect(placeholders.length).toBe(matches);
  });

  it("keeps control / false-positive examples", async () => {
    const files = loadTestFiles();
    const txt = files.find(f => f.name === "incident-notes.txt")!;
    const extracted = await extractDocument(txt.buffer, txt.mime, txt.name);
    const scrubbed = scrubExtracted(extracted.text);
    expect(extracted.text).toContain(SYNTH.privateIp);
    expect(scrubbed.sanitized).toContain(SYNTH.privateIp);
    expect(scrubbed.sanitized).toContain(SYNTH.falseCard);
    expect(scrubbed.sanitized).toContain(SYNTH.dob);
    expect(scrubbed.sanitized).toContain(SYNTH.routing);
    expect(scrubbed.sanitized).toContain(SYNTH.password);
    for (const keep of MUST_PRESERVE_BALANCED) {
      if (extracted.text.includes(keep)) {
        expect(scrubbed.sanitized).toContain(keep);
      }
    }
    expect(scrubbed.sanitized).not.toContain(SYNTH.publicIp);
  });

  it("retains sheet/cell provenance on spreadsheet extracts", async () => {
    const files = loadTestFiles();
    const xlsx = files.find(f => f.name === "employee-register.xlsx")!;
    const csv = files.find(f => f.name === "support-tickets.csv")!;
    const xExtracted = await extractDocument(xlsx.buffer, xlsx.mime, xlsx.name);
    const cExtracted = await extractDocument(csv.buffer, csv.mime, csv.name);
    expect(xExtracted.chunks?.length).toBeGreaterThan(0);
    expect(xExtracted.chunks?.some(c => c.provenance?.sheet === "Employees")).toBe(true);
    expect(xExtracted.chunks?.some(c => /Employees!/i.test(c.provenance?.range ?? ""))).toBe(true);
    expect(cExtracted.chunks?.[0]?.provenance?.range).toMatch(/support-tickets/i);
    expect(xExtracted.tables?.some(t => t.headers.includes("Email"))).toBe(true);
  });

  it("never supplies raw secrets as the model-bound representation", async () => {
    const files = loadTestFiles();
    for (const file of files) {
      const extracted = await extractDocument(file.buffer, file.mime, file.name);
      const forModel = scrubExtracted(extracted.text).sanitized;
      expect(forModel).not.toContain(SYNTH.ssn);
      expect(forModel).not.toContain(SYNTH.card);
      expect(forModel).not.toContain(SYNTH.cardSpaced);
      expect(forModel).not.toContain(SYNTH.awsKey);
      expect(forModel).not.toContain(SYNTH.githubPat);
      expect(forModel).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
      const payload = JSON.stringify({
        role: "user",
        content: forModel,
      });
      expect(payload).not.toContain(SYNTH.awsKey);
    }
  });
});

describe("security analytics events reject raw secrets", () => {
  it("returns 422 when a client tries to smuggle a detected value", async () => {
    const { POST } = await import("@/app/api/analytics/security/route");
    const res = await POST(
      new NextRequest("http://localhost/api/analytics/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{
            category: "secret",
            source: "knowledge_document",
            outcome: "redacted",
            count: 1,
            value: SYNTH.awsKey,
          }],
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/raw or context/i);
  });
});
