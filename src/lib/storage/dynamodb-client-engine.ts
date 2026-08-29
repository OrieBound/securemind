/**
 * DynamoDB item I/O for Knowledge fragments.
 * SearchVectors when the table/SDK support it; otherwise Query + cosine (Floci).
 * `@aws-sdk/client-dynamodb` 3.1116 does not yet export SearchVectorsCommand
 * (API GA 2026-08-05; dedicated search endpoints). Local proof uses Query + cosine.
 *
 * Local clients use LOCAL_AWS_ENDPOINT (Floci), same pattern as Cognito.
 * Real AWS clients are built inside withRealAwsEndpoints() so Floci does not intercept.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { LOCAL_AWS_CREDENTIALS, LOCAL_AWS_ENDPOINT } from "@/lib/aws-endpoint";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import {
  ATTR,
  attributeListToNumbers,
  fragmentsTableName,
  numbersToAttributeList,
  searchVectorAttributeList,
  type DynamoFragmentRecord,
  DYNAMODB_VECTOR_INDEX_NAME,
} from "./dynamodb-schema";
import {
  cosineHitsFromPartition,
  hitFromSearchVectorsScore,
  type VectorEngine,
  type VectorEngineSearch,
  type VectorSearchHit,
} from "./vector-engine";

function region(): string {
  return (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.DYNAMODB_REGION ||
    "us-east-1"
  );
}

export function createFragmentsDynamoClient(): DynamoDBClient {
  const endpoint = LOCAL_AWS_ENDPOINT;
  if (endpoint) {
    return new DynamoDBClient({
      region: region(),
      endpoint,
      credentials: LOCAL_AWS_CREDENTIALS,
    });
  }
  return new DynamoDBClient({ region: region() });
}

function recordToItem(record: DynamoFragmentRecord): Record<string, AttributeValue> {
  const item: Record<string, AttributeValue> = {
    [ATTR.workspaceId]: { S: record.workspaceId },
    [ATTR.fragmentId]: { S: record.fragmentId },
    [ATTR.userId]: { S: record.userId },
    [ATTR.category]: { S: record.category },
    [ATTR.content]: { S: record.content },
    [ATTR.embedding]: numbersToAttributeList(record.embedding),
  };
  if (record.documentId) item[ATTR.documentId] = { S: record.documentId };
  if (record.documentName) item[ATTR.documentName] = { S: record.documentName };
  if (record.provenanceJson) item[ATTR.provenance] = { S: record.provenanceJson };
  return item;
}

function itemToRecord(item: Record<string, AttributeValue>): DynamoFragmentRecord | null {
  const workspaceId = item[ATTR.workspaceId]?.S;
  const fragmentId = item[ATTR.fragmentId]?.S;
  const userId = item[ATTR.userId]?.S;
  const category = item[ATTR.category]?.S;
  const content = item[ATTR.content]?.S;
  const embedding = attributeListToNumbers(item[ATTR.embedding]);
  if (!workspaceId || !fragmentId || !userId || !category || content == null) return null;
  if (embedding.length === 0) return null;
  return {
    workspaceId,
    fragmentId,
    userId,
    category,
    content,
    documentId: item[ATTR.documentId]?.S ?? null,
    documentName: item[ATTR.documentName]?.S ?? null,
    provenanceJson: item[ATTR.provenance]?.S ?? null,
    embedding,
  };
}

function isSearchVectorsUnsupported(err: unknown): boolean {
  const e = err as { name?: string; message?: string; Code?: string };
  const name = `${e?.name ?? ""} ${e?.Code ?? ""}`;
  const msg = (e?.message ?? "").toLowerCase();
  if (/SearchVectorsUnsupported|UnknownOperation|SerializationException/i.test(name)) return true;
  if (msg.includes("searchvectors") && (msg.includes("unknown") || msg.includes("not exist"))) {
    return true;
  }
  if (msg.includes("does not have the specified index")) return true;
  return false;
}

type SearchVectorsInput = {
  TableName: string;
  IndexName: string;
  SearchVector: { N: string }[];
  TopK: number;
  SearchConditionExpression: string;
  ExpressionAttributeValues: Record<string, AttributeValue>;
};

type SearchVectorsOutput = {
  SearchResults?: Array<{ Item?: Record<string, AttributeValue>; Score?: number }>;
};

async function sendSearchVectors(
  client: DynamoDBClient,
  input: SearchVectorsInput,
): Promise<SearchVectorsOutput> {
  const mod = (await import("@aws-sdk/client-dynamodb")) as Record<string, unknown>;
  const Ctor = mod.SearchVectorsCommand;
  if (typeof Ctor !== "function") {
    const err = new Error("SearchVectors is not in this AWS SDK build");
    err.name = "SearchVectorsUnsupported";
    throw err;
  }
  const command = new (Ctor as new (i: SearchVectorsInput) => object)(input);
  return client.send(command as Parameters<DynamoDBClient["send"]>[0]) as Promise<SearchVectorsOutput>;
}

async function queryPartition(
  client: DynamoDBClient,
  tableName: string,
  workspaceId: string,
): Promise<DynamoFragmentRecord[]> {
  const records: DynamoFragmentRecord[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const out = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#ws = :ws",
        ExpressionAttributeNames: { "#ws": ATTR.workspaceId },
        ExpressionAttributeValues: { ":ws": { S: workspaceId } },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of out.Items ?? []) {
      const rec = itemToRecord(item);
      if (rec) records.push(rec);
    }
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return records;
}

async function withClient<T>(client: DynamoDBClient, fn: () => Promise<T>): Promise<T> {
  if (LOCAL_AWS_ENDPOINT) return fn();
  return withRealAwsEndpoints(fn);
}

export function createDynamoDbVectorEngine(opts?: {
  client?: DynamoDBClient;
  tableName?: string;
}): VectorEngine {
  const client = opts?.client ?? createFragmentsDynamoClient();
  const tableName = opts?.tableName ?? fragmentsTableName();

  return {
    async put(record) {
      await withClient(client, async () => {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: recordToItem(record),
          }),
        );
      });
    },

    async search(opts: VectorEngineSearch): Promise<VectorSearchHit[]> {
      return withClient(client, async () => {
        try {
          const out = await sendSearchVectors(client, {
            TableName: tableName,
            IndexName: DYNAMODB_VECTOR_INDEX_NAME,
            SearchVector: searchVectorAttributeList(opts.vector),
            TopK: opts.topK,
            SearchConditionExpression: "workspaceId = :ws AND userId = :uid AND category = :cat",
            ExpressionAttributeValues: {
              ":ws": { S: opts.workspaceId },
              ":uid": { S: opts.userId },
              ":cat": { S: opts.category },
            },
          });
          const hits: VectorSearchHit[] = [];
          for (const row of out.SearchResults ?? []) {
            if (!row.Item) continue;
            const rec = itemToRecord(row.Item);
            if (!rec) continue;
            // Defense in depth: never trust SearchVectors to enforce tenant scope.
            if (
              rec.workspaceId !== opts.workspaceId ||
              rec.userId !== opts.userId ||
              rec.category !== opts.category
            ) {
              continue;
            }
            hits.push(hitFromSearchVectorsScore(rec, Number(row.Score ?? 2)));
          }
          return hits;
        } catch (err) {
          if (!isSearchVectorsUnsupported(err)) throw err;
          const records = await queryPartition(client, tableName, opts.workspaceId);
          return cosineHitsFromPartition(records, opts);
        }
      });
    },

    async deleteOwned({ workspaceId, fragmentId, userId }) {
      return withClient(client, async () => {
        try {
          await client.send(
            new DeleteItemCommand({
              TableName: tableName,
              Key: {
                [ATTR.workspaceId]: { S: workspaceId },
                [ATTR.fragmentId]: { S: fragmentId },
              },
              ConditionExpression: "userId = :uid",
              ExpressionAttributeValues: { ":uid": { S: userId } },
            }),
          );
          return true;
        } catch (err) {
          const name = (err as { name?: string }).name ?? "";
          if (name === "ConditionalCheckFailedException") return false;
          throw err;
        }
      });
    },
  };
}
