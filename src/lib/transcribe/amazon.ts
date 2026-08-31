/**
 * Amazon Transcribe Streaming — in-memory PCM, no S3.
 * Same billable-AWS gate as Bedrock. Audio never lands on disk.
 */

import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import { getInstanceAwsStatus, resolveRuntimeSecrets } from "@/lib/instance-config";
import { pcmFromWav, wavSampleRate } from "./pcm-wav";

export type AmazonTranscriptEvent = {
  kind: "partial" | "final";
  text: string;
};

async function withTranscribeClient<T>(
  fn: (client: import("@aws-sdk/client-transcribe-streaming").TranscribeStreamingClient) => Promise<T>,
): Promise<T> {
  const secrets = await resolveRuntimeSecrets();
  const status = await getInstanceAwsStatus();
  const region = secrets.bedrockRegion || status.region || "us-east-1";
  return withRealAwsEndpoints(async () => {
    const { TranscribeStreamingClient } = await import("@aws-sdk/client-transcribe-streaming");
    const credentials = status.profile
      ? (await import("@aws-sdk/credential-providers")).fromNodeProviderChain({
          profile: status.profile,
        })
      : undefined;
    const client = new TranscribeStreamingClient({
      region,
      ...(credentials ? { credentials } : {}),
    });
    return fn(client);
  });
}

function eventsFromResult(
  result: {
    IsPartial?: boolean;
    Alternatives?: Array<{ Transcript?: string }>;
  },
): AmazonTranscriptEvent | null {
  const piece = result.Alternatives?.[0]?.Transcript?.trim();
  if (!piece) return null;
  return { kind: result.IsPartial ? "partial" : "final", text: piece };
}

export async function* transcribePcmStream(
  pcmChunks: AsyncIterable<Uint8Array>,
  sampleRate = wavSampleRate(),
): AsyncGenerator<AmazonTranscriptEvent> {
  const { StartStreamTranscriptionCommand } = await import("@aws-sdk/client-transcribe-streaming");
  const audioStream = (async function* () {
    for await (const chunk of pcmChunks) {
      if (chunk.byteLength === 0) continue;
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  })();

  const out = await withTranscribeClient(client =>
    client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: "en-US",
        MediaEncoding: "pcm",
        MediaSampleRateHertz: sampleRate,
        AudioStream: audioStream,
      }),
    ),
  );

  if (!out.TranscriptResultStream) return;
  for await (const event of out.TranscriptResultStream) {
    const results = event.TranscriptEvent?.Transcript?.Results ?? [];
    for (const result of results) {
      const mapped = eventsFromResult(result);
      if (mapped) yield mapped;
    }
  }
}

export async function transcribeWithAmazon(wav: Buffer): Promise<string> {
  const parsed = pcmFromWav(wav);
  if (!parsed) {
    throw new Error("Audio must be 16-bit mono PCM WAV.");
  }
  const { pcm, sampleRate: parsedRate } = parsed;
  const sampleRate = parsedRate || wavSampleRate();
  const chunkSize = 8 * 1024;
  async function* chunks() {
    for (let i = 0; i < pcm.length; i += chunkSize) {
      yield new Uint8Array(pcm.subarray(i, i + chunkSize));
    }
  }
  let text = "";
  for await (const ev of transcribePcmStream(chunks(), sampleRate)) {
    if (ev.kind === "final") text = text ? `${text} ${ev.text}` : ev.text;
  }
  return text;
}
