/**
 * Direct live captions: the browser opens its own WebSocket to Amazon Transcribe.
 *
 * Amplify's server receives an upload in one piece, so streaming the microphone through our own
 * route cannot show words while you speak. This route hands the browser a short-lived signed address
 * instead. To keep that address harmless it is signed with temporary credentials from a separate IAM
 * role that can do exactly one thing, open a Transcribe streaming connection, for fifteen minutes at
 * most. The compute role's own credentials never leave the server.
 *
 * Off unless `TRANSCRIBE_STREAM_ROLE_ARN` and `TRANSCRIBE_STREAM_REGION` are both set (Terraform sets
 * them on the hosted install). Without them the app uses the older route, which still works.
 */

import { createHash } from "node:crypto";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import { getInstanceAwsStatus } from "@/lib/instance-config";
import { isValidAwsRegion, presignTranscribeWebSocketUrl, PRESIGN_SECONDS, type TemporaryCredentials } from "./presign";

export const TRANSCRIBE_STREAM_SAMPLE_RATE = 16_000;
/** The shortest session STS allows. The signed address is good for five minutes of it. */
const ROLE_SESSION_SECONDS = 900;

export type TranscribeStreamConfig = { roleArn: string; region: string };

const ROLE_ARN = /^arn:aws(?:-[a-z]+)*:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;

/** The settings, or null when direct captions are not set up here. */
export function transcribeStreamConfig(
  env: Record<string, string | undefined> = process.env,
): TranscribeStreamConfig | null {
  const roleArn = env.TRANSCRIBE_STREAM_ROLE_ARN?.trim();
  const region = env.TRANSCRIBE_STREAM_REGION?.trim();
  if (!roleArn || !ROLE_ARN.test(roleArn)) return null;
  if (!isValidAwsRegion(region)) return null;
  return { roleArn, region };
}

/** A role session name that identifies the caller in CloudTrail without carrying an email or id. */
export function roleSessionName(userId: string): string {
  return `sm-voice-${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
}

/** Limits the temporary credentials further than the role itself does. */
const SESSION_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Action: "transcribe:StartStreamTranscriptionWebSocket", Resource: "*" }],
});

export async function createTranscribeStreamUrl(
  config: TranscribeStreamConfig,
  userId: string,
): Promise<{ url: string; expiresInSeconds: number; sampleRate: number }> {
  const status = await getInstanceAwsStatus();
  const credentials = await withRealAwsEndpoints(async () => {
    const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
    const base = status.profile
      ? (await import("@aws-sdk/credential-providers")).fromNodeProviderChain({ profile: status.profile })
      : undefined;
    const sts = new STSClient({ region: config.region, ...(base ? { credentials: base } : {}) });
    const out = await sts.send(
      new AssumeRoleCommand({
        RoleArn: config.roleArn,
        RoleSessionName: roleSessionName(userId),
        DurationSeconds: ROLE_SESSION_SECONDS,
        Policy: SESSION_POLICY,
      }),
    );
    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new Error("STS returned no credentials");
    const temp: TemporaryCredentials = {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
    };
    return temp;
  });
  const url = presignTranscribeWebSocketUrl({
    region: config.region,
    credentials,
    sampleRate: TRANSCRIBE_STREAM_SAMPLE_RATE,
  });
  return { url, expiresInSeconds: PRESIGN_SECONDS, sampleRate: TRANSCRIBE_STREAM_SAMPLE_RATE };
}
