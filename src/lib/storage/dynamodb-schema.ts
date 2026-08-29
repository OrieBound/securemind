/**
 * Hosted DynamoDB fragment table — locked in ADR 0007.
 * Index settings are immutable after create; do not mix embedding dimensions.
 */

export const DYNAMODB_FRAGMENTS_TABLE_DEFAULT = "securemind-fragments";
export const DYNAMODB_VECTOR_INDEX_NAME = "workspace-vectors";
export const DYNAMODB_VECTOR_ATTR = "embedding";

export const ATTR = {
  workspaceId: "workspaceId",
  fragmentId: "fragmentId",
  userId: "userId",
  category: "category",
  content: "content",
  documentId: "documentId",
  documentName: "documentName",
  provenance: "provenance",
  embedding: DYNAMODB_VECTOR_ATTR,
} as const;

export type DynamoFragmentRecord = {
  workspaceId: string;
  fragmentId: string;
  userId: string;
  category: string;
  content: string;
  documentId: string | null;
  documentName: string | null;
  provenanceJson: string | null;
  embedding: number[];
};

export function fragmentsTableName(): string {
  const n = process.env.DYNAMODB_FRAGMENTS_TABLE?.trim();
  return n || DYNAMODB_FRAGMENTS_TABLE_DEFAULT;
}

export function assertEmbeddingDimensions(vector: number[], expected: number): void {
  if (vector.length !== expected) {
    throw new Error(
      `Embedding has ${vector.length} dims; this DynamoDB vector index is locked to ${expected}. ` +
        `Create a new table to change models (index settings are immutable).`,
    );
  }
}

export function numbersToAttributeList(values: number[]): { L: { N: string }[] } {
  return { L: values.map((n) => ({ N: String(n) })) };
}

export function searchVectorAttributeList(values: number[]): { N: string }[] {
  return values.map((n) => ({ N: String(n) }));
}

export function attributeListToNumbers(value: { L?: { N?: string }[] } | undefined): number[] {
  const list = value?.L;
  if (!Array.isArray(list)) return [];
  const out: number[] = [];
  for (const el of list) {
    const n = Number(el?.N);
    if (!Number.isFinite(n)) return [];
    out.push(n);
  }
  return out;
}
