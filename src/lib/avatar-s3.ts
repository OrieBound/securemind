/**
 * Hosted avatar bytes in a private S3 bucket.
 * IAM from the Lambda role — never an access key in the UI or database.
 * Clients are built inside withRealAwsEndpoints() so Floci's AWS_ENDPOINT_URL
 * does not redirect this traffic to localhost.
 */

import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import type { AvatarImageKind, AvatarMeta } from "@/lib/avatar-image";

function region(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    process.env.COGNITO_REGION?.trim() ||
    "us-east-1"
  );
}

async function withS3<T>(
  fn: (client: import("@aws-sdk/client-s3").S3Client) => Promise<T>,
): Promise<T> {
  return withRealAwsEndpoints(async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const client = new S3Client({ region: region() });
    try {
      return await fn(client);
    } finally {
      client.destroy();
    }
  });
}

export async function s3ReadAvatar(
  bucket: string,
  key: string,
): Promise<{ bytes: Buffer; meta: AvatarMeta } | null> {
  try {
    return await withS3(async client => {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = out.Body;
      if (!body) return null;
      const bytes = Buffer.from(await body.transformToByteArray());
      const contentType = out.ContentType === "image/png" ? "image/png" : "image/jpeg";
      const updatedAt =
        (typeof out.Metadata?.updatedat === "string" && out.Metadata.updatedat) ||
        out.LastModified?.toISOString() ||
        new Date().toISOString();
      return { bytes, meta: { contentType, updatedAt } };
    });
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

export async function s3HeadAvatar(bucket: string, key: string): Promise<AvatarMeta | null> {
  try {
    return await withS3(async client => {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const contentType = out.ContentType === "image/png" ? "image/png" : "image/jpeg";
      const updatedAt =
        (typeof out.Metadata?.updatedat === "string" && out.Metadata.updatedat) ||
        out.LastModified?.toISOString() ||
        new Date().toISOString();
      return { contentType, updatedAt };
    });
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
    const status = err && typeof err === "object" && "$metadata" in err
      ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) return null;
    throw err;
  }
}

export async function s3WriteAvatar(
  bucket: string,
  key: string,
  bytes: Buffer,
  contentType: AvatarImageKind,
): Promise<AvatarMeta> {
  const meta: AvatarMeta = { contentType, updatedAt: new Date().toISOString() };
  await withS3(async client => {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      Metadata: { updatedat: meta.updatedAt },
    }));
  });
  return meta;
}

export async function s3RemoveAvatar(bucket: string, key: string): Promise<void> {
  await withS3(async client => {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  });
}
