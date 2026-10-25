/**
 * Signs the WebSocket address the browser uses to talk to Amazon Transcribe Streaming directly.
 *
 * AWS Signature Version 4, "query string" form: the signature rides in the address, so the browser
 * needs no secret of its own. The address is good for five minutes and only to open the connection.
 * Written with Node's crypto so there is no extra dependency; the tests pin the output.
 */

import { createHash, createHmac } from "node:crypto";

export type TemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export const TRANSCRIBE_STREAM_PORT = 8443;
export const TRANSCRIBE_STREAM_PATH = "/stream-transcription-websocket";
/** AWS allows at most five minutes for a signed Transcribe WebSocket address. */
export const PRESIGN_SECONDS = 300;

export function transcribeStreamHost(region: string): string {
  return `transcribestreaming.${region}.amazonaws.com`;
}

/** A region name as AWS writes them (us-east-1, eu-central-2, us-gov-west-1). Anything else is refused. */
export function isValidAwsRegion(region: string | null | undefined): region is string {
  return typeof region === "string" && /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(region);
}

const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 percent-encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone). */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function presignTranscribeWebSocketUrl(opts: {
  region: string;
  credentials: TemporaryCredentials;
  sampleRate: number;
  languageCode?: string;
  now?: Date;
}): string {
  if (!isValidAwsRegion(opts.region)) throw new Error("invalid region");
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${opts.region}/transcribe/aws4_request`;
  const hostHeader = `${transcribeStreamHost(opts.region)}:${TRANSCRIBE_STREAM_PORT}`;

  const query: Record<string, string> = {
    "language-code": opts.languageCode ?? "en-US",
    "media-encoding": "pcm",
    "sample-rate": String(opts.sampleRate),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${opts.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(PRESIGN_SECONDS),
    "X-Amz-Security-Token": opts.credentials.sessionToken,
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map(k => `${encode(k)}=${encode(query[k]!)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    TRANSCRIBE_STREAM_PATH,
    canonicalQuery,
    `host:${hostHeader}\n`,
    "host",
    sha256Hex(""),
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, "transcribe");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `wss://${hostHeader}${TRANSCRIBE_STREAM_PATH}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
