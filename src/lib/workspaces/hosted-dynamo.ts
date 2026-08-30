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
      return {
        sessionId: session.id,
        workspaceId,
        messages: limited,
        sessionSummary: "",
        summarizedCount: 0,
        extractedFacts: {},
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
  };
}

export type HostedAppStore = ReturnType<typeof createHostedAppStore>;

let singleton: HostedAppStore | null = null;

export function hostedAppStore(): HostedAppStore {
  singleton ??= createHostedAppStore(createDynamoDriver());
  return singleton;
}

/** Tests only. */
export function resetHostedAppStoreForTests(): void {
  singleton = null;
}
