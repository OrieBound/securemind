import { describe, expect, it } from "vitest";
import {
  PRESIGN_SECONDS,
  isValidAwsRegion,
  presignTranscribeWebSocketUrl,
} from "./presign";

const credentials = {
  accessKeyId: "ASIAEXAMPLEKEY",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  sessionToken: "TOKEN+/=abc",
};
const now = new Date("2026-10-25T12:34:56Z");

describe("presignTranscribeWebSocketUrl", () => {
  it("matches the signature AWS's own SigV4 library produces for the same request", () => {
    // Reference value computed with @smithy/signature-v4 (service "transcribe", host with :8443, 300 s).
    const url = new URL(presignTranscribeWebSocketUrl({ region: "us-east-1", credentials, sampleRate: 16000, now }));
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("transcribestreaming.us-east-1.amazonaws.com:8443");
    expect(url.pathname).toBe("/stream-transcription-websocket");
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      "348469c1aac5eab986dfcf1b03a326339aef75a8b8a4517d58e8c705bc6e2ee9",
    );
  });

  it("asks for 16 kHz PCM English and expires in five minutes", () => {
    const url = new URL(presignTranscribeWebSocketUrl({ region: "us-east-1", credentials, sampleRate: 16000, now }));
    expect(url.searchParams.get("media-encoding")).toBe("pcm");
    expect(url.searchParams.get("sample-rate")).toBe("16000");
    expect(url.searchParams.get("language-code")).toBe("en-US");
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_SECONDS));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261025T123456Z");
  });

  it("never puts the secret access key in the address", () => {
    const url = presignTranscribeWebSocketUrl({ region: "us-east-1", credentials, sampleRate: 16000, now });
    expect(url).not.toContain(credentials.secretAccessKey);
    expect(decodeURIComponent(url)).not.toContain(credentials.secretAccessKey);
  });

  it("changes when anything signed changes", () => {
    const a = presignTranscribeWebSocketUrl({ region: "us-east-1", credentials, sampleRate: 16000, now });
    const b = presignTranscribeWebSocketUrl({ region: "us-east-1", credentials, sampleRate: 8000, now });
    const c = presignTranscribeWebSocketUrl({ region: "us-west-2", credentials, sampleRate: 16000, now });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("refuses a region that is not a plain AWS region name", () => {
    for (const region of ["", "evil.com/x", "us-east-1.attacker.example", "US-EAST-1", "us east 1"]) {
      expect(() => presignTranscribeWebSocketUrl({ region, credentials, sampleRate: 16000, now })).toThrow();
    }
  });
});

describe("regions and origins", () => {
  it("accepts real region names and rejects the rest", () => {
    for (const ok of ["us-east-1", "ca-central-1", "eu-central-2", "us-gov-west-1", "ap-southeast-2"]) {
      expect(isValidAwsRegion(ok), ok).toBe(true);
    }
    for (const bad of ["", null, undefined, "us-east", "x", "a.b-c-1", "us-east-1:8443"]) {
      expect(isValidAwsRegion(bad as string | null | undefined), String(bad)).toBe(false);
    }
  });
});
