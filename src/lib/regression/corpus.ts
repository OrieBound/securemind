/**
 * Synthetic regression corpus for extraction + detection tests.
 * All values are fictional. Nothing here is a real person, account, or secret.
 */

import { crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const SYNTH = {
  email: "jordan.hale@northwind-synth.test",
  emailRepeat: "jordan.hale@northwind-synth.test",
  ssn: "123-45-6789",
  card: "4242424242424242",
  cardSpaced: "4242 4242 4242 4242",
  phone: "(415) 555-0142",
  publicIp: "8.8.8.8",
  privateIp: "10.0.4.12",
  awsKey: "AKIAIOSFODNN7EXAMPLE",
  githubPat: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  awsSecretLine: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  street: "742 Evergreen Street",
  dob: "1978-04-12",
  routing: "110000000",
  password: "Winter-Lake-94!",
  ticketId: "INC-1042",
  controlProse: "the deploy finished and the queue drained normally",
  falseCard: "1234567890123456",
} as const;

/** Values that policy at `balanced` must redact from extracted text. */
export const MUST_REDACT_BALANCED = [
  SYNTH.email,
  SYNTH.ssn,
  SYNTH.card,
  SYNTH.cardSpaced,
  SYNTH.phone,
  SYNTH.publicIp,
  SYNTH.awsKey,
  SYNTH.githubPat,
] as const;

/** Harmless / out-of-policy strings that must survive balanced scrub. */
export const MUST_PRESERVE_BALANCED = [
  SYNTH.controlProse,
  SYNTH.ticketId,
  SYNTH.falseCard,
  SYNTH.dob,
  SYNTH.routing,
  SYNTH.password,
  SYNTH.privateIp,
] as const;

export const EXPECTED_FINDINGS = {
  policy: "balanced",
  note: "Detection follows src/lib/pii.ts. DOB, names, routing numbers, and passwords are not pattern families at balanced.",
  files: {
    "customer-case.docx": {
      format: "docx",
      expectCategories: ["email", "SSN", "phone", "secret"],
      location: "paragraph / document body",
    },
    "service-agreement.pdf": {
      format: "pdf",
      expectCategories: ["email", "SSN", "card number", "secret"],
      location: "page text",
    },
    "employee-register.xlsx": {
      format: "xlsx",
      expectCategories: ["email", "SSN", "phone", "secret"],
      location: "sheet/cell via provenance.range",
    },
    "support-tickets.csv": {
      format: "csv",
      expectCategories: ["email", "secret"],
      location: "sheet/cell via provenance.range",
    },
    "incident-notes.txt": {
      format: "txt",
      expectCategories: ["email", "IP address", "secret", "phone"],
      location: "plain text",
    },
    "app-config.json": {
      format: "json",
      expectCategories: ["email", "SSN", "secret"],
      location: "nested object keys preserved",
    },
  },
  controls: {
    privateIpSafeListed: SYNTH.privateIp,
    luhnFailTrace: SYNTH.falseCard,
    harmlessProse: SYNTH.controlProse,
  },
};

function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Uncompressed ZIP (store) for a minimal OOXML package. */
export function zipStore(files: Record<string, string | Buffer>): Buffer {
  const { time, date } = dosTime();
  const chunks: Buffer[] = [];
  const entries: { nameBuf: Buffer; crc: number; size: number; offset: number }[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    entries.push({ nameBuf, crc: crc >>> 0, size: data.length, offset });
    offset += 30 + nameBuf.length + data.length;
  }

  const cdStart = offset;
  for (const e of entries) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.size, 20);
    cd.writeUInt32LE(e.size, 24);
    cd.writeUInt16LE(e.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(e.offset, 42);
    chunks.push(cd, e.nameBuf);
    offset += 46 + e.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function para(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function buildCustomerCaseDocx(): Buffer {
  const paragraphs = [
    "Northwind Synth — customer case (synthetic)",
    `Contact: ${SYNTH.email}  Phone: ${SYNTH.phone}`,
    `Government id on file: ${SYNTH.ssn}`,
    `Repeat contact for consistency check: ${SYNTH.emailRepeat}`,
    `AWS access key id quoted in ticket: ${SYNTH.awsKey}`,
    `Date of birth (not a detection family at balanced): ${SYNTH.dob}`,
    `Ship-to note at high sensitivity: ${SYNTH.street}`,
    SYNTH.controlProse,
    `Control ticket ${SYNTH.ticketId} closed after review.`,
  ];
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs.map(para).join("")}</w:body></w:document>`;

  return zipStore({
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
    "word/_rels/document.xml.rels":
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    "word/document.xml": documentXml,
  });
}

export async function buildServiceAgreementPdf(): Promise<Buffer> {
  const line =
    `SYNTHETIC CONTRACT. Party contact ${SYNTH.email}. SSN ${SYNTH.ssn}. ` +
    `Card on file ${SYNTH.cardSpaced}. Key ${SYNTH.awsKey}. ` +
    `Control: ${SYNTH.controlProse}. Ticket ${SYNTH.ticketId}. Trace ${SYNTH.falseCard}.`;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const wrapped = [line.slice(0, 90), line.slice(90)].filter(Boolean);
  wrapped.forEach((chunk, i) => {
    page.drawText(chunk, {
      x: 48,
      y: 720 - i * 14,
      size: 10,
      font,
    });
  });
  const bytes = await pdf.save({ useObjectStreams: false });
  return Buffer.from(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export async function buildEmployeeRegisterXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const employees = wb.addWorksheet("Employees");
  employees.addRow(["Name", "Email", "SSN", "Phone", "DOB"]);
  employees.addRow(["Jordan Hale", SYNTH.email, SYNTH.ssn, SYNTH.phone, SYNTH.dob]);
  employees.addRow(["Jordan Hale (repeat)", SYNTH.emailRepeat, SYNTH.ssn, SYNTH.phone, SYNTH.dob]);

  const creds = wb.addWorksheet("Credentials");
  creds.addRow(["Service", "Key"]);
  creds.addRow(["aws", SYNTH.awsKey]);
  creds.addRow(["github", SYNTH.githubPat]);
  creds.addRow(["aws_secret", SYNTH.awsSecretLine]);

  const controls = wb.addWorksheet("Controls");
  controls.addRow(["Id", "Note", "Trace"]);
  controls.addRow([SYNTH.ticketId, SYNTH.controlProse, SYNTH.falseCard]);
  controls.addRow(["NET", `private host ${SYNTH.privateIp}`, SYNTH.routing]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildSupportTicketsCsv(): string {
  return [
    "ticket_id,reporter,description,control",
    `${SYNTH.ticketId},${SYNTH.email},"API token ${SYNTH.githubPat} posted in thread",${SYNTH.controlProse}`,
    `INC-1043,${SYNTH.emailRepeat},"repeat reporter same inbox",ok`,
    `INC-1999,ops-bot,"trace ${SYNTH.falseCard} is not a card",${SYNTH.controlProse}`,
  ].join("\n");
}

export function buildIncidentNotesTxt(): string {
  return [
    "Incident notes (synthetic) — do not treat as real.",
    `Reporter ${SYNTH.email} called ${SYNTH.phone}.`,
    `Public resolver ${SYNTH.publicIp} timed out; internal probe ${SYNTH.privateIp} (RFC1918, default safe term).`,
    `Credential paste: ${SYNTH.awsKey}`,
    `${SYNTH.awsSecretLine}`,
    `Bank routing-shaped value (not a detection family): ${SYNTH.routing}`,
    `Password field (not a detection family): ${SYNTH.password}`,
    `Control trace id (fails Luhn, not a card): ${SYNTH.falseCard}`,
    `Date of birth (not a detection family): ${SYNTH.dob}`,
    SYNTH.controlProse,
    `Control ticket ${SYNTH.ticketId} closed after review.`,
    `Repeat email ${SYNTH.emailRepeat} appeared in the follow-up.`,
  ].join("\n");
}

export function buildAppConfigJson(): string {
  return JSON.stringify(
    {
      app: "northwind-synth",
      user: {
        email: SYNTH.email,
        ssn: SYNTH.ssn,
        dob: SYNTH.dob,
      },
      credentials: {
        aws_access_key_id: SYNTH.awsKey,
        github_token: SYNTH.githubPat,
        postgres_url: `postgres://appuser:${SYNTH.password}@db.internal:5432/securemind`,
      },
      control: {
        ticket: SYNTH.ticketId,
        note: SYNTH.controlProse,
        trace: SYNTH.falseCard,
      },
    },
    null,
    2,
  );
}

export type CorpusFile = {
  name: string;
  mime: string;
  buffer: Buffer;
};

export async function buildCorpusFiles(): Promise<CorpusFile[]> {
  return [
    {
      name: "customer-case.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: buildCustomerCaseDocx(),
    },
    {
      name: "service-agreement.pdf",
      mime: "application/pdf",
      buffer: await buildServiceAgreementPdf(),
    },
    {
      name: "employee-register.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await buildEmployeeRegisterXlsx(),
    },
    {
      name: "support-tickets.csv",
      mime: "text/csv",
      buffer: Buffer.from(buildSupportTicketsCsv(), "utf8"),
    },
    {
      name: "incident-notes.txt",
      mime: "text/plain",
      buffer: Buffer.from(buildIncidentNotesTxt(), "utf8"),
    },
    {
      name: "app-config.json",
      mime: "application/json",
      buffer: Buffer.from(buildAppConfigJson(), "utf8"),
    },
  ];
}

export async function writeRegressionCorpus(rootDir: string): Promise<void> {
  const testFiles = join(rootDir, "test-files");
  mkdirSync(testFiles, { recursive: true });
  const files = await buildCorpusFiles();
  for (const file of files) {
    writeFileSync(join(testFiles, file.name), file.buffer);
  }
  writeFileSync(
    join(testFiles, "expected-findings.json"),
    JSON.stringify(EXPECTED_FINDINGS, null, 2) + "\n",
  );
}
