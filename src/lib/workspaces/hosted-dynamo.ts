/**
 * Hosted app records (workspaces, sessions, messages) on the fragments table.
 *
 * Knowledge vectors stay on real workspace partitions. These rows use a
 * per-user partition (`app#<userId>`) so they never mix with SearchVectors.
 */

import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import { LOCAL_AWS_ENDPOINT } from "@/lib/aws-endpoint";
import { createFragmentsDynamoClient } from "@/lib/storage/dynamodb-client-engine";
import { ATTR, fragmentsTableName } from "@/lib/storage/dynamodb-schema";
import {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_WORKSPACE_DESCRIPTION,
  DEFAULT_WORKSPACE_EMOJI,
  DEFAULT_WORKSPACE_NAME,
  LEGACY_DEFAULT_NAMES,
} from "./defaults";
import { defaultWorkspaceHello, isLegacyDefaultHello } from "@/lib/onboarding";

const CATEGORY = "app_meta";
const WS = "ws#";
const SE = "se#";
const MS = "ms#";
const PF = "pf#";
const DC = "dc#";
const BM = "bm#";
const INF = "inf#";
const SEC = "sec#";
const AU = "au#";
/** Instance-wide partition. A Cognito sub can never equal this, so it cannot collide with a user. */
const AUDIT_PK = "app#_audit";
const FT = "ft#";
const SM = "sm#";
const MAX_DOC_CONTENT_CHARS = 80_000;

export type HostedWorkspace = {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  color: string;
  context: string | null;
  description: string | null;
  modelOverride: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HostedSession = {
  id: string;
  userId: string;
  workspaceId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HostedMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
};

export type HostedProfile = {
  userId: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  jobTitle: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  avatarPreset: string;
  themePreference: string | null;
  density: string | null;
  defaultLanding: string | null;
  defaultWorkspaceId: string | null;
  preferredModelId: string | null;
  notificationPrefs: unknown;
  status: string;
  monthlyCostCapUsd: number | null;
  lastSignInAt: string | null;
  deletedAt: string | null;
  deletedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HostedDocumentChunk = {
  id: string;
  content: string;
  createdAt: string;
  provenance: unknown;
};

export type HostedDocument = {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  status: string;
  chunkCount: number;
  redactionCount: number;
  scrubEvents: unknown;
  processingError: string | null;
  storageKey: string | null;
  extractMeta: unknown;
  processedAt: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  fragmentIds: string[];
  chunks: HostedDocumentChunk[];
};

export type HostedSavedItem = {
  id: string;
  userId: string;
  workspaceId: string;
  messageId: string;
  label: string;
  preview: string;
  role: string | null;
  heavy: boolean;
  createdAt: string;
};

export type HostedSecurityEvent = {
  id: string;
  userId: string;
  workspaceId: string | null;
  at: string;
  source: string;
  category: string;
  riskLevel: string;
  outcome: string;
  count: number;
  sensitivity: string | null;
  resourceKind: string | null;
  resourceId: string | null;
};

export type HostedInferenceEvent = {
  id: string;
  userId: string;
  workspaceId: string | null;
  sessionId: string | null;
  messageId: string | null;
  at: string;
  provider: string;
  model: string;
  tier: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  status: string;
  retrievalHitCount: number;
  citationCount: number;
  groundingStatus: string | null;
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
  turnMode: string | null;
  retrievalAttempted: boolean;
  retrievalReasonCode: string | null;
  candidateCount: number;
  evidenceCount: number;
  sourcesCited: number;
  retrievalMs: number | null;
  insufficientEvidence: boolean;
  attachmentUsed: boolean;
};

export type HostedAuditEvent = {
  id: string;
  at: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  target: string | null;
  outcome: string;
  detail: string | null;
};

export type HostedWorkspaceFact = {
  id: string;
  userId: string;
  workspaceId: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  pinned: boolean;
  forgotten: boolean;
  correctedAt: string | null;
  correctedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HostedSessionSummary = {
  id: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  summary: string;
  turnsCovered: number;
  updatedAt: string;
};

export type HostedEventQuery = {
  workspaceId?: string | null;
  fromIso?: string | null;
  take?: number;
};

export type WorkspaceListRow = HostedWorkspace & {
  sessions: Array<HostedSession & { messages: HostedMessage[] }>;
};

export type SessionPayload = {
  sessionId: string;
  workspaceId: string;
  messages: HostedMessage[];
  sessionSummary: string;
  summarizedCount: number;
  extractedFacts: Record<string, string>;
};

export type HostedDriver = {
  put(pk: string, sk: string, item: Record<string, AttributeValue>): Promise<void>;
  get(pk: string, sk: string): Promise<Record<string, AttributeValue> | null>;
  queryPrefix(pk: string, skPrefix: string): Promise<Record<string, AttributeValue>[]>;
  delete(pk: string, sk: string): Promise<void>;
  batchDelete(keys: Array<{ pk: string; sk: string }>): Promise<void>;
};

function userPk(userId: string): string {
  return `app#${userId}`;
}

function wsSk(id: string): string {
  return `${WS}${id}`;
}

function seSk(workspaceId: string, sessionId: string): string {
  return `${SE}${workspaceId}#${sessionId}`;
}

function msSk(sessionId: string, createdAt: string, messageId: string): string {
  return `${MS}${sessionId}#${createdAt}#${messageId}`;
}

function pfSk(): string {
  return `${PF}self`;
}

function dcSk(id: string): string {
  return `${DC}${id}`;
}

function bmSk(workspaceId: string, messageId: string): string {
  return `${BM}${workspaceId}#${messageId}`;
}

function infSk(at: string, id: string): string {
  return `${INF}${at}#${id}`;
}

function secSk(at: string, id: string): string {
  return `${SEC}${at}#${id}`;
}

function ftSk(workspaceId: string, key: string): string {
  return `${FT}${workspaceId}#${key}`;
}

function smSk(workspaceId: string, sessionId: string): string {
  return `${SM}${workspaceId}#${sessionId}`;
}

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function contentOf(item: Record<string, AttributeValue>): string {
  return item[ATTR.content]?.S ?? "";
}

async function withClient<T>(client: DynamoDBClient, fn: () => Promise<T>): Promise<T> {
  if (LOCAL_AWS_ENDPOINT) return fn();
  return withRealAwsEndpoints(fn);
}

export function createDynamoDriver(opts?: {
  client?: DynamoDBClient;
  tableName?: string;
}): HostedDriver {
  const client = opts?.client ?? createFragmentsDynamoClient();
  const tableName = opts?.tableName ?? fragmentsTableName();

  return {
    async put(pk, sk, item) {
      await withClient(client, async () => {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              ...item,
              [ATTR.workspaceId]: { S: pk },
              [ATTR.fragmentId]: { S: sk },
            },
          }),
        );
      });
    },

    async get(pk, sk) {
      return withClient(client, async () => {
        const out = await client.send(
          new GetItemCommand({
            TableName: tableName,
            Key: {
              [ATTR.workspaceId]: { S: pk },
              [ATTR.fragmentId]: { S: sk },
            },
          }),
        );
        return out.Item ?? null;
      });
    },

    async queryPrefix(pk, skPrefix) {
      const items: Record<string, AttributeValue>[] = [];
      let startKey: Record<string, AttributeValue> | undefined;
      do {
        const out = await withClient(client, async () =>
          client.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
              ExpressionAttributeNames: {
                "#pk": ATTR.workspaceId,
                "#sk": ATTR.fragmentId,
              },
              ExpressionAttributeValues: {
                ":pk": { S: pk },
                ":prefix": { S: skPrefix },
              },
              ExclusiveStartKey: startKey,
            }),
          ),
        );
        items.push(...(out.Items ?? []));
        startKey = out.LastEvaluatedKey;
      } while (startKey);
      return items;
    },

    async delete(pk, sk) {
      await withClient(client, async () => {
        await client.send(
          new DeleteItemCommand({
            TableName: tableName,
            Key: {
              [ATTR.workspaceId]: { S: pk },
              [ATTR.fragmentId]: { S: sk },
            },
          }),
        );
      });
    },

    async batchDelete(keys) {
      for (let i = 0; i < keys.length; i += 25) {
        const chunk = keys.slice(i, i + 25);
        await withClient(client, async () => {
          await client.send(
            new BatchWriteItemCommand({
              RequestItems: {
                [tableName]: chunk.map(k => ({
                  DeleteRequest: {
                    Key: {
                      [ATTR.workspaceId]: { S: k.pk },
                      [ATTR.fragmentId]: { S: k.sk },
                    },
                  },
                })),
              },
            }),
          );
        });
      }
    },
  };
}

export function createMemoryDriver(): HostedDriver {
  const rows = new Map<string, Record<string, AttributeValue>>();
  const key = (pk: string, sk: string) => `${pk}\0${sk}`;

  return {
    async put(pk, sk, item) {
      rows.set(key(pk, sk), {
        ...item,
        [ATTR.workspaceId]: { S: pk },
        [ATTR.fragmentId]: { S: sk },
      });
    },
    async get(pk, sk) {
      return rows.get(key(pk, sk)) ?? null;
    },
    async queryPrefix(pk, skPrefix) {
      const out: Record<string, AttributeValue>[] = [];
      for (const [k, item] of rows) {
        const sep = k.indexOf("\0");
        const itemPk = k.slice(0, sep);
        const itemSk = k.slice(sep + 1);
        if (itemPk === pk && itemSk.startsWith(skPrefix)) out.push(item);
      }
      out.sort((a, b) => (a[ATTR.fragmentId]?.S ?? "").localeCompare(b[ATTR.fragmentId]?.S ?? ""));
      return out;
    },
    async delete(pk, sk) {
      rows.delete(key(pk, sk));
    },
    async batchDelete(keys) {
      for (const k of keys) rows.delete(key(k.pk, k.sk));
    },
  };
}

function metaItem(userId: string, json: unknown): Record<string, AttributeValue> {
  return {
    [ATTR.userId]: { S: userId },
    [ATTR.category]: { S: CATEGORY },
    [ATTR.content]: { S: JSON.stringify(json) },
  };
}

function asWorkspace(item: Record<string, AttributeValue>): HostedWorkspace | null {
  const row = parseJson<HostedWorkspace | null>(contentOf(item), null);
  if (!row?.id || !row.userId) return null;
  return row;
}

function asSession(item: Record<string, AttributeValue>): HostedSession | null {
  const row = parseJson<HostedSession | null>(contentOf(item), null);
  if (!row?.id || !row.workspaceId) return null;
  return row;
}

function asMessage(item: Record<string, AttributeValue>): HostedMessage | null {
  const row = parseJson<HostedMessage | null>(contentOf(item), null);
  if (!row?.id || !row.sessionId) return null;
  return row;
}

function asProfile(item: Record<string, AttributeValue>): HostedProfile | null {
  const row = parseJson<HostedProfile | null>(contentOf(item), null);
  if (!row?.userId) return null;
  return row;
}

function asDocument(item: Record<string, AttributeValue>): HostedDocument | null {
  const row = parseJson<HostedDocument | null>(contentOf(item), null);
  if (!row?.id || !row.userId) return null;
  return {
    ...row,
    fragmentIds: row.fragmentIds ?? [],
    chunks: row.chunks ?? [],
  };
}

function asSavedItem(item: Record<string, AttributeValue>): HostedSavedItem | null {
  const row = parseJson<HostedSavedItem | null>(contentOf(item), null);
  if (!row?.id || !row.userId || !row.workspaceId || !row.messageId) return null;
  return row;
}

function asSecurityEvent(item: Record<string, AttributeValue>): HostedSecurityEvent | null {
  const row = parseJson<HostedSecurityEvent | null>(contentOf(item), null);
  if (!row?.id || !row.userId || !row.at) return null;
  return row;
}

function asInferenceEvent(item: Record<string, AttributeValue>): HostedInferenceEvent | null {
  const row = parseJson<HostedInferenceEvent | null>(contentOf(item), null);
  if (!row?.id || !row.userId || !row.at) return null;
  return row;
}

function asFact(item: Record<string, AttributeValue>): HostedWorkspaceFact | null {
  const row = parseJson<HostedWorkspaceFact | null>(contentOf(item), null);
  if (!row?.id || !row.userId || !row.workspaceId || !row.key) return null;
  return row;
}

function asSessionSummary(item: Record<string, AttributeValue>): HostedSessionSummary | null {
  const row = parseJson<HostedSessionSummary | null>(contentOf(item), null);
  if (!row?.id || !row.userId || !row.sessionId || !row.workspaceId) return null;
  return row;
}

function filterEvents<T extends { userId: string; workspaceId: string | null; at: string }>(
  userId: string,
  rows: T[],
  query?: HostedEventQuery,
): T[] {
  let out = rows.filter(row => row.userId === userId);
  if (query?.workspaceId) {
    out = out.filter(row => row.workspaceId === query.workspaceId);
  }
  if (query?.fromIso) {
    out = out.filter(row => row.at >= query.fromIso!);
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  const take = query?.take;
  if (typeof take === "number" && take > 0) return out.slice(0, take);
  return out;
}

function capDocContent(text: string): string {
  if (text.length <= MAX_DOC_CONTENT_CHARS) return text;
  return text.slice(0, MAX_DOC_CONTENT_CHARS);
}

export function createHostedAppStore(driver: HostedDriver) {
  async function putWorkspace(row: HostedWorkspace): Promise<void> {
    await driver.put(userPk(row.userId), wsSk(row.id), metaItem(row.userId, row));
  }

  async function putSession(row: HostedSession): Promise<void> {
    await driver.put(userPk(row.userId), seSk(row.workspaceId, row.id), metaItem(row.userId, row));
  }

  async function putMessage(userId: string, row: HostedMessage): Promise<void> {
    await driver.put(
      userPk(userId),
      msSk(row.sessionId, row.createdAt, row.id),
      metaItem(userId, row),
    );
  }

  async function listWorkspaceRows(userId: string): Promise<HostedWorkspace[]> {
    const items = await driver.queryPrefix(userPk(userId), WS);
    return items.map(asWorkspace).filter((w): w is HostedWorkspace => Boolean(w));
  }

  async function listSessions(userId: string, workspaceId: string): Promise<HostedSession[]> {
    const items = await driver.queryPrefix(userPk(userId), `${SE}${workspaceId}#`);
    return items.map(asSession).filter((s): s is HostedSession => Boolean(s));
  }

  async function listMessages(userId: string, sessionId: string): Promise<HostedMessage[]> {
    const items = await driver.queryPrefix(userPk(userId), `${MS}${sessionId}#`);
    return items.map(asMessage).filter((m): m is HostedMessage => Boolean(m));
  }

  async function lastMessage(userId: string, sessionId: string): Promise<HostedMessage | null> {
    const messages = await listMessages(userId, sessionId);
    return messages.length ? messages[messages.length - 1]! : null;
  }

  async function attachPreview(userId: string, ws: HostedWorkspace): Promise<WorkspaceListRow> {
    const sessions = await listSessions(userId, ws.id);
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const latest = sessions[0];
    if (!latest) return { ...ws, sessions: [] };
    const msg = await lastMessage(userId, latest.id);
    return {
      ...ws,
      sessions: [{ ...latest, messages: msg ? [msg] : [] }],
    };
  }

  async function seedDefault(userId: string): Promise<HostedWorkspace> {
    const ts = nowIso();
    const row: HostedWorkspace = {
      id: newId(),
      userId,
      name: DEFAULT_WORKSPACE_NAME,
      emoji: DEFAULT_WORKSPACE_EMOJI,
      color: DEFAULT_WORKSPACE_COLOR,
      context: null,
      description: DEFAULT_WORKSPACE_DESCRIPTION,
      modelOverride: null,
      isDefault: true,
      createdAt: ts,
      updatedAt: ts,
    };
    await putWorkspace(row);
    return row;
  }

  async function getWorkspace(
    userId: string,
    id: string,
  ): Promise<(HostedWorkspace & { facts: [] }) | null> {
    const item = await driver.get(userPk(userId), wsSk(id));
    if (!item) return null;
    const row = asWorkspace(item);
    if (!row || row.userId !== userId) return null;
    return { ...row, facts: [] };
  }

  async function findOwned(
    userId: string,
    id: string,
  ): Promise<Pick<HostedWorkspace, "id" | "name" | "context" | "isDefault"> | null> {
    const row = await getWorkspace(userId, id);
    if (!row) return null;
    return { id: row.id, name: row.name, context: row.context, isDefault: row.isDefault };
  }

  async function getProfile(userId: string): Promise<HostedProfile | null> {
    const item = await driver.get(userPk(userId), pfSk());
    if (!item) return null;
    const row = asProfile(item);
    if (!row || row.userId !== userId) return null;
    return row;
  }

  async function putProfile(row: HostedProfile): Promise<HostedProfile> {
    await driver.put(userPk(row.userId), pfSk(), metaItem(row.userId, row));
    return row;
  }

  async function listDocuments(userId: string, workspaceId?: string | null): Promise<HostedDocument[]> {
    const items = await driver.queryPrefix(userPk(userId), DC);
    let rows = items
      .map(asDocument)
      .filter((d): d is HostedDocument => d != null && d.userId === userId);
    if (workspaceId) {
      rows = rows.filter(d => d.workspaceId === workspaceId || d.workspaceId == null);
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }

  async function getDocument(userId: string, id: string): Promise<HostedDocument | null> {
    const item = await driver.get(userPk(userId), dcSk(id));
    if (!item) return null;
    const row = asDocument(item);
    if (!row || row.userId !== userId) return null;
    return row;
  }

  async function putDocument(row: HostedDocument): Promise<HostedDocument> {
    const stored: HostedDocument = {
      ...row,
      content: capDocContent(row.content ?? ""),
      chunks: (row.chunks ?? []).map(c => ({
        ...c,
        content: capDocContent(c.content),
      })),
    };
    await driver.put(userPk(row.userId), dcSk(row.id), metaItem(row.userId, stored));
    return stored;
  }

  async function deleteDocument(userId: string, id: string): Promise<HostedDocument | null> {
    const existing = await getDocument(userId, id);
    if (!existing) return null;
    await driver.delete(userPk(userId), dcSk(id));
    return existing;
  }

  async function listBookmarks(userId: string, workspaceId: string): Promise<HostedSavedItem[]> {
    const items = await driver.queryPrefix(userPk(userId), `${BM}${workspaceId}#`);
    const rows = items
      .map(asSavedItem)
      .filter((row): row is HostedSavedItem => row != null && row.userId === userId);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }

  async function putBookmark(row: HostedSavedItem): Promise<HostedSavedItem> {
    await driver.put(userPk(row.userId), bmSk(row.workspaceId, row.messageId), metaItem(row.userId, row));
    return row;
  }

  async function deleteBookmark(
    userId: string,
    workspaceId: string,
    messageId: string,
  ): Promise<HostedSavedItem | null> {
    const item = await driver.get(userPk(userId), bmSk(workspaceId, messageId));
    if (!item) return null;
    const row = asSavedItem(item);
    if (!row || row.userId !== userId) return null;
    await driver.delete(userPk(userId), bmSk(workspaceId, messageId));
    return row;
  }

  async function listSecurityEvents(
    userId: string,
    query?: HostedEventQuery,
  ): Promise<HostedSecurityEvent[]> {
    const items = await driver.queryPrefix(userPk(userId), SEC);
    const rows = items
      .map(asSecurityEvent)
      .filter((row): row is HostedSecurityEvent => row != null);
    return filterEvents(userId, rows, query);
  }

  async function putSecurityEvent(row: HostedSecurityEvent): Promise<HostedSecurityEvent> {
    await driver.put(userPk(row.userId), secSk(row.at, row.id), metaItem(row.userId, row));
    return row;
  }

  async function putAudit(row: HostedAuditEvent): Promise<void> {
    await driver.put(AUDIT_PK, `${AU}${row.at}#${row.id}`, metaItem("instance", row));
  }

  async function listAudit(take = 200): Promise<HostedAuditEvent[]> {
    const items = await driver.queryPrefix(AUDIT_PK, AU);
    return items
      .map(i => parseJson<HostedAuditEvent | null>(contentOf(i), null))
      .filter((r): r is HostedAuditEvent => Boolean(r?.id && r.at))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, take);
  }

  async function listInferenceEvents(
    userId: string,
    query?: HostedEventQuery,
  ): Promise<HostedInferenceEvent[]> {
    const items = await driver.queryPrefix(userPk(userId), INF);
    const rows = items
      .map(asInferenceEvent)
      .filter((row): row is HostedInferenceEvent => row != null);
    return filterEvents(userId, rows, query);
  }

  async function putInferenceEvent(row: HostedInferenceEvent): Promise<HostedInferenceEvent> {
    await driver.put(userPk(row.userId), infSk(row.at, row.id), metaItem(row.userId, row));
    return row;
  }

  async function listFacts(userId: string, workspaceId: string): Promise<HostedWorkspaceFact[]> {
    const items = await driver.queryPrefix(userPk(userId), `${FT}${workspaceId}#`);
    const rows = items
      .map(asFact)
      .filter((row): row is HostedWorkspaceFact => row != null && row.userId === userId);
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return rows;
  }

  async function putFact(row: HostedWorkspaceFact): Promise<HostedWorkspaceFact> {
    await driver.put(userPk(row.userId), ftSk(row.workspaceId, row.key), metaItem(row.userId, row));
    return row;
  }

  async function getFactById(
    userId: string,
    workspaceId: string,
    factId: string,
  ): Promise<HostedWorkspaceFact | null> {
    return (await listFacts(userId, workspaceId)).find(f => f.id === factId) ?? null;
  }

  async function deleteFact(
    userId: string,
    workspaceId: string,
    factId: string,
  ): Promise<HostedWorkspaceFact | null> {
    const existing = await getFactById(userId, workspaceId, factId);
    if (!existing) return null;
    await driver.delete(userPk(userId), ftSk(workspaceId, existing.key));
    return existing;
  }

  async function listSessionSummaries(
    userId: string,
    workspaceId: string,
  ): Promise<HostedSessionSummary[]> {
    const items = await driver.queryPrefix(userPk(userId), `${SM}${workspaceId}#`);
    const rows = items
      .map(asSessionSummary)
      .filter((row): row is HostedSessionSummary => row != null && row.userId === userId);
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows;
  }

  async function putSessionSummary(row: HostedSessionSummary): Promise<HostedSessionSummary> {
    await driver.put(
      userPk(row.userId),
      smSk(row.workspaceId, row.sessionId),
      metaItem(row.userId, row),
    );
    return row;
  }

  async function getSessionSummary(
    userId: string,
    workspaceId: string,
    sessionId: string,
  ): Promise<HostedSessionSummary | null> {
    const item = await driver.get(userPk(userId), smSk(workspaceId, sessionId));
    if (!item) return null;
    const row = asSessionSummary(item);
    if (!row || row.userId !== userId) return null;
    return row;
  }

  return {
    async listWorkspaces(userId: string): Promise<WorkspaceListRow[]> {
      let rows = await listWorkspaceRows(userId);
      if (rows.length === 0) {
        rows = [await seedDefault(userId)];
      }
      const legacy = rows.find(
        w => w.isDefault && (LEGACY_DEFAULT_NAMES as readonly string[]).includes(w.name),
      );
      if (legacy) {
        const updated: HostedWorkspace = {
          ...legacy,
          name: DEFAULT_WORKSPACE_NAME,
          emoji: legacy.emoji === "☁️" ? DEFAULT_WORKSPACE_EMOJI : legacy.emoji,
          description: legacy.description ?? DEFAULT_WORKSPACE_DESCRIPTION,
          updatedAt: nowIso(),
        };
        await putWorkspace(updated);
        rows = await listWorkspaceRows(userId);
      }
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return Promise.all(rows.map(ws => attachPreview(userId, ws)));
    },

    async createWorkspace(
      userId: string,
      input: {
        name: string;
        emoji?: string;
        color?: string;
        description?: string | null;
        context?: string | null;
      },
    ): Promise<HostedWorkspace> {
      const ts = nowIso();
      const row: HostedWorkspace = {
        id: newId(),
        userId,
        name: input.name,
        emoji: input.emoji ?? "🗂️",
        color: input.color ?? DEFAULT_WORKSPACE_COLOR,
        context: input.context ?? null,
        description: input.description ?? null,
        modelOverride: null,
        isDefault: false,
        createdAt: ts,
        updatedAt: ts,
      };
      await putWorkspace(row);
      return row;
    },

    getWorkspace,
    findOwned,

    async updateWorkspace(
      userId: string,
      id: string,
      patch: Partial<Pick<HostedWorkspace, "name" | "emoji" | "color" | "description" | "context" | "modelOverride">>,
    ): Promise<HostedWorkspace | null> {
      const existing = await getWorkspace(userId, id);
      if (!existing) return null;
      const { facts: _facts, ...rest } = existing;
      const next: HostedWorkspace = {
        ...rest,
        ...patch,
        updatedAt: nowIso(),
      };
      await putWorkspace(next);
      return next;
    },

    async countWorkspaces(userId: string): Promise<number> {
      return (await listWorkspaceRows(userId)).length;
    },

    async deleteWorkspace(userId: string, id: string): Promise<boolean> {
      const existing = await getWorkspace(userId, id);
      if (!existing) return false;
      const pk = userPk(userId);
      const sessions = await listSessions(userId, id);
      const keys: Array<{ pk: string; sk: string }> = [{ pk, sk: wsSk(id) }];
      for (const session of sessions) {
        keys.push({ pk, sk: seSk(id, session.id) });
        const messages = await listMessages(userId, session.id);
        for (const msg of messages) {
          keys.push({ pk, sk: msSk(session.id, msg.createdAt, msg.id) });
        }
      }
      await driver.batchDelete(keys);
      return true;
    },

    async loadSession(userId: string, workspaceId: string): Promise<SessionPayload | null> {
      const owned = await findOwned(userId, workspaceId);
      if (!owned) return null;

      let sessions = await listSessions(userId, workspaceId);
      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      let session = sessions[0];
      if (!session) {
        const ts = nowIso();
        session = {
          id: newId(),
          userId,
          workspaceId,
          title: null,
          createdAt: ts,
          updatedAt: ts,
        };
        await putSession(session);
      }

      let messages = await listMessages(userId, session.id);
      if (owned.isDefault && messages.length === 0) {
        const hello: HostedMessage = {
          id: newId(),
          sessionId: session.id,
          role: "assistant",
          content: defaultWorkspaceHello(owned.name),
          createdAt: nowIso(),
        };
        await putMessage(userId, hello);
        messages = [hello];
      } else if (owned.isDefault) {
        const first = messages.find(m => m.role === "assistant");
        if (first && isLegacyDefaultHello(first.content)) {
          const next = { ...first, content: defaultWorkspaceHello(owned.name) };
          await putMessage(userId, next);
          messages = messages.map(m => (m.id === first.id ? next : m));
        }
      }

      const limited = messages.slice(-200);
      const [summaryRow, facts] = await Promise.all([
        getSessionSummary(userId, workspaceId, session.id),
        listFacts(userId, workspaceId),
      ]);
      const extractedFacts: Record<string, string> = {};
      for (const f of facts) {
        if (!f.forgotten) extractedFacts[f.key] = f.value;
      }
      return {
        sessionId: session.id,
        workspaceId,
        messages: limited,
        sessionSummary: summaryRow?.summary ?? "",
        summarizedCount: summaryRow?.turnsCovered ?? 0,
        extractedFacts,
      };
    },

    async appendMessage(
      userId: string,
      sessionId: string,
      role: string,
      content: string,
    ): Promise<{ id: string } | null> {
      const sessions = await driver.queryPrefix(userPk(userId), SE);
      const owned = sessions
        .map(asSession)
        .find(s => s && s.userId === userId && s.id === sessionId);
      if (!owned) return null;

      const msg: HostedMessage = {
        id: newId(),
        sessionId,
        role,
        content,
        createdAt: nowIso(),
      };
      await putMessage(userId, msg);
      await putSession({ ...owned, updatedAt: msg.createdAt });
      return { id: msg.id };
    },

    getProfile,
    putProfile,
    listDocuments,
    getDocument,
    putDocument,
    deleteDocument,
    listBookmarks,
    putBookmark,
    deleteBookmark,
    listSecurityEvents,
    putSecurityEvent,
    putAudit,
    listAudit,
    listInferenceEvents,
    putInferenceEvent,
    listFacts,
    putFact,
    getFactById,
    deleteFact,
    listSessionSummaries,
    putSessionSummary,
    getSessionSummary,
    peekWorkspaces: listWorkspaceRows,

    async findDuplicateDocument(
      userId: string,
      name: string,
      sizeBytes: number,
      workspaceId: string | null,
    ): Promise<HostedDocument | null> {
      const rows = await listDocuments(userId, workspaceId);
      return (
        rows.find(
          d =>
            d.name === name
            && d.sizeBytes === sizeBytes
            && (workspaceId ? d.workspaceId === workspaceId : d.workspaceId == null)
            && d.status !== "failed",
        ) ?? null
      );
    },
  };
}

export type HostedAppStore = ReturnType<typeof createHostedAppStore>;

let singleton: HostedAppStore | null = null;

export function hostedAppStore(): HostedAppStore {
  singleton ??= createHostedAppStore(createDynamoDriver());
  return singleton;
}

/** Tests only. Pass a store to inject a memory driver. */
export function resetHostedAppStoreForTests(store?: HostedAppStore): void {
  singleton = store ?? null;
}
