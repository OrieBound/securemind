/**
 * Module-load snapshot of the local AWS endpoint override (Floci / LocalStack).
 *
 * `withRealAwsEndpoints()` in `src/lib/aws-credentials.ts` temporarily removes
 * `AWS_ENDPOINT_URL` from `process.env` so that resolving real AWS credentials
 * and calling Bedrock are not redirected to the local stub. Anything that reads
 * that variable lazily — especially a client that memoizes its config on first
 * use — can therefore observe it as missing and cache the wrong endpoint for
 * the life of the process.
 *
 * Read this snapshot instead of `process.env.AWS_ENDPOINT_URL` directly.
 */
export const LOCAL_AWS_ENDPOINT: string | undefined =
  process.env.AWS_ENDPOINT_URL?.trim() || undefined;

/** Static credentials for the local stub, snapshotted for the same reason. */
export const LOCAL_AWS_CREDENTIALS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() || "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim() || "test",
};

/**
 * True when `url` points at a real AWS service host (amazonaws.com), not a local stub and not a
 * lookalike such as http://localhost/amazonaws.com. Compares the host name, never a substring.
 */
export function isAwsHostedEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "amazonaws.com" ||
      host.endsWith(".amazonaws.com") ||
      host.endsWith(".amazonaws.com.cn")
    );
  } catch {
    return false;
  }
}
