/**
 * Interrupted uploads: documents stuck in "processing" are settled as failed on read,
 * scoped to the caller, and Reprocess says so plainly when there is nothing to work from.
 * Mocks the database, so no Postgres is needed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  status: string;
  processingError: string | null;
  processedAt: Date | null;
  createdAt: Date;
  content: string;
  storageKey: string | null;
};

const table = vi.hoisted(() => ({ rows: [] as Row[] }));
const calls = vi.hoisted(() => ({ updateMany: [] as unknown[] }));
const persisted = vi.hoisted(() => ({
  doc: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/workspaces/store", () => ({ usesHostedAppStore: () => false }));
vi.mock("@/lib/workspaces/hosted-dynamo", () => ({ hostedAppStore: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    document: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        table.rows.filter(r => r.userId === where.userId),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
        table.rows.find(r => r.id === where.id && r.userId === where.userId) ?? null,
      ),
      updateMany: vi.fn(
        async (args: {
          where: { id: string; userId: string; status: string };
          data: Partial<Row>;
        }) => {
          calls.updateMany.push(args);
          const row = table.rows.find(
            r =>
              r.id === args.where.id &&
              r.userId === args.where.userId &&
              r.status === args.where.status,
          );
          if (!row) return { count: 0 };
          Object.assign(row, args.data);
          return { count: 1 };
        },
      ),
    },
  },
}));

import { getPersistedDocument, listPersistedDocuments } from "@/lib/documents/persist";

const NOW = Date.now();
function row(over: Partial<Row>): Row {
  return {
    id: "d1",
    userId: "alice",
    workspaceId: "ws",
    name: "a.txt",
    status: "processing",
    processingError: null,
    processedAt: null,
    createdAt: new Date(NOW - 30 * 60_000),
    content: "",
    storageKey: null,
    ...over,
  };
}

beforeEach(() => {
  table.rows = [];
  calls.updateMany.length = 0;
});

describe("settling interrupted documents", () => {
  it("fails a stale document, leaves fresh and finished ones alone", async () => {
    table.rows = [
      row({ id: "stuck" }),
      row({ id: "fresh", createdAt: new Date(NOW - 60_000) }),
      row({ id: "done", status: "ready", createdAt: new Date(NOW - 99 * 60_000) }),
      row({ id: "bad", status: "failed", processingError: "EMPTY_EXTRACT" }),
    ];
    const docs = await listPersistedDocuments("alice", "ws");
    const by = Object.fromEntries(docs.map(d => [d.id, d]));
    expect(by.stuck.status).toBe("failed");
    expect(by.stuck.processingError).toBe("INTERRUPTED");
    expect(by.stuck.processedAt).toBeInstanceOf(Date);
    expect(by.fresh.status).toBe("processing");
    expect(by.done.status).toBe("ready");
    expect(by.bad.processingError).toBe("EMPTY_EXTRACT");
    expect(calls.updateMany).toHaveLength(1);
  });

  it("scopes the update to the caller and to documents still processing", async () => {
    table.rows = [row({ id: "stuck", userId: "alice" }), row({ id: "theirs", userId: "bob" })];
    await listPersistedDocuments("alice", "ws");
    expect(calls.updateMany).toHaveLength(1);
    expect(calls.updateMany[0]).toMatchObject({
      where: { id: "stuck", userId: "alice", status: "processing" },
    });
    expect(table.rows.find(r => r.id === "theirs")!.status).toBe("processing");
  });

  it("never touches another user's document through get", async () => {
    table.rows = [row({ id: "theirs", userId: "bob" })];
    expect(await getPersistedDocument("alice", "theirs")).toBeNull();
    expect(calls.updateMany).toHaveLength(0);
    expect(table.rows[0].status).toBe("processing");
  });

  it("settles a single stale document on get", async () => {
    table.rows = [row({ id: "stuck" })];
    const doc = await getPersistedDocument("alice", "stuck");
    expect(doc?.status).toBe("failed");
    expect(doc?.processingError).toBe("INTERRUPTED");
  });

  it("does not overwrite a run that finished while we were checking", async () => {
    const stuck = row({ id: "stuck" });
    table.rows = [stuck];
    const { db } = await import("@/lib/db");
    vi.mocked(db.document.updateMany).mockImplementationOnce((async () => {
      // The real ingest completes just before our guarded update runs.
      stuck.status = "ready";
      return { count: 0 };
    }) as never);
    const doc = await getPersistedDocument("alice", "stuck");
    expect(doc?.status).toBe("ready");
    expect(doc?.processingError).toBeNull();
  });

  it("does not treat a freshly reprocessed old document as interrupted", async () => {
    table.rows = [
      row({
        id: "re",
        createdAt: new Date(NOW - 40 * 24 * 3600_000),
        processedAt: new Date(NOW - 20_000),
      }),
    ];
    const doc = await getPersistedDocument("alice", "re");
    expect(doc?.status).toBe("processing");
    expect(calls.updateMany).toHaveLength(0);
  });
});

describe("Reprocess route", () => {
  beforeEach(() => {
    persisted.doc = null;
    persisted.updates.length = 0;
    vi.resetModules();
    vi.doMock("@/lib/identity", () => ({
      getIdentity: vi.fn(async () => ({
        userId: "alice",
        authenticated: true,
        role: "member",
        groups: [],
      })),
    }));
    vi.doMock("@/lib/documents/persist", () => ({
      getPersistedDocument: vi.fn(async (userId: string) =>
        persisted.doc && (persisted.doc as { userId: string }).userId === userId
          ? persisted.doc
          : null,
      ),
      updatePersistedDocument: vi.fn(
        async (_u: string, _id: string, patch: Record<string, unknown>) => {
          persisted.updates.push(patch);
          return { ...(persisted.doc ?? {}), ...patch };
        },
      ),
    }));
    vi.doMock("@/lib/document-storage", () => ({
      originalExists: vi.fn(() => false),
      readOriginal: vi.fn(),
    }));
    vi.doMock("@/lib/documents", () => ({
      extractDocument: vi.fn(),
      scrubDocumentText: vi.fn(),
      processDocument: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/runtime-env", () => ({ shouldSyncDocumentIngest: () => true }));
  });

  async function post(id: string) {
    const { POST } = await import("@/app/api/documents/[id]/reprocess/route");
    return POST(
      new NextRequest(`http://localhost/api/documents/${id}/reprocess`, { method: "POST" }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("returns 404 and writes nothing for another user's document", async () => {
    persisted.doc = { id: "x", userId: "bob", content: "text", storageKey: null, status: "failed" };
    const res = await post("x");
    expect(res.status).toBe(404);
    expect(persisted.updates).toEqual([]);
  });

  it("says plainly there is nothing to reprocess when no original and no text exist", async () => {
    persisted.doc = {
      id: "x",
      userId: "alice",
      content: "",
      storageKey: null,
      status: "failed",
      mimeType: "text/plain",
      name: "x.txt",
    };
    const res = await post("x");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("NO_SOURCE");
    expect(body.error).toMatch(/upload the file again/i);
    expect(persisted.updates.some(u => u.status === "processing")).toBe(false);
    expect(persisted.updates[0]).toMatchObject({ status: "failed", processingError: "NO_SOURCE" });
  });

  it("restarts the processing clock when a document with stored text is reprocessed", async () => {
    persisted.doc = {
      id: "x",
      userId: "alice",
      content: "some stored text",
      storageKey: null,
      status: "failed",
      mimeType: "text/plain",
      name: "x.txt",
    };
    const res = await post("x");
    expect(res.status).toBe(200);
    const start = persisted.updates.find(u => u.status === "processing");
    expect(start).toBeDefined();
    expect(start!.processedAt).toBeInstanceOf(Date);
    expect(start!.processingError).toBeNull();
  });
});
