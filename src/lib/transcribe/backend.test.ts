import { describe, expect, it } from "vitest";
import {
  parseVoiceSttChoice,
  pickTranscribeBackend,
  transcribeUnavailableMessage,
  voiceCaptionMode,
  voiceProviderDestination,
  voiceProviderLabel,
} from "./backend";
import { encodePcm16Wav, pcmFromWav } from "./pcm-wav";

describe("parseVoiceSttChoice", () => {
  it("accepts groq and transcribe only", () => {
    expect(parseVoiceSttChoice("groq")).toBe("groq");
    expect(parseVoiceSttChoice("transcribe")).toBe("transcribe");
    expect(parseVoiceSttChoice(null)).toBeNull();
    expect(parseVoiceSttChoice("whisper")).toBeNull();
  });
});

describe("pickTranscribeBackend", () => {
  it("does nothing until the operator chooses a provider and acknowledges audio leave", () => {
    expect(
      pickTranscribeBackend({
        edition: "cloud",
        groqOk: true,
        awsOk: true,
        choice: null,
        audioAcked: true,
      }),
    ).toBeNull();
    expect(
      pickTranscribeBackend({
        edition: "cloud",
        groqOk: true,
        awsOk: true,
        choice: "transcribe",
        audioAcked: false,
      }),
    ).toBeNull();
  });

  it("uses Groq when that option is chosen even if Amazon Transcribe is available", () => {
    expect(
      pickTranscribeBackend({
        edition: "cloud",
        groqOk: true,
        awsOk: true,
        choice: "groq",
        audioAcked: true,
      }),
    ).toBe("groq");
  });

  it("uses Amazon Transcribe when that option is chosen", () => {
    expect(
      pickTranscribeBackend({
        edition: "cloud",
        groqOk: true,
        awsOk: true,
        choice: "transcribe",
        audioAcked: true,
      }),
    ).toBe("transcribe");
  });

  it("does not fall back to the other vendor", () => {
    expect(
      pickTranscribeBackend({
        edition: "cloud",
        groqOk: false,
        awsOk: true,
        choice: "groq",
        audioAcked: true,
      }),
    ).toBeNull();
    expect(
      pickTranscribeBackend({
        edition: "cloud",
        groqOk: true,
        awsOk: false,
        choice: "transcribe",
        audioAcked: true,
      }),
    ).toBeNull();
  });

  it("allows Amazon Transcribe on local when explicitly chosen", () => {
    expect(
      pickTranscribeBackend({
        edition: "local",
        groqOk: true,
        awsOk: true,
        choice: "transcribe",
        audioAcked: true,
      }),
    ).toBe("transcribe");
  });

  it("uses Groq on local when chosen", () => {
    expect(
      pickTranscribeBackend({
        edition: "local",
        groqOk: true,
        awsOk: true,
        choice: "groq",
        audioAcked: true,
      }),
    ).toBe("groq");
  });
});

describe("transcribeUnavailableMessage", () => {
  it("asks for a first-use choice when none is stored", () => {
    expect(
      transcribeUnavailableMessage({
        choice: null,
        groqOk: true,
        awsOk: true,
        audioAcked: false,
      }),
    ).toMatch(/Choose Groq Whisper or Amazon Transcribe/i);
  });
});

describe("voiceCaptionMode", () => {
  it("streams Amazon Transcribe partials on hosted Chromium", () => {
    expect(
      voiceCaptionMode({
        edition: "cloud",
        provider: "transcribe",
        livePcmSupported: true,
      }),
    ).toBe("pcm-stream");
  });

  it("uses the same chunked live preview for Groq on hosted and local", () => {
    expect(
      voiceCaptionMode({
        edition: "cloud",
        provider: "groq",
        livePcmSupported: true,
      }),
    ).toBe("chunked-preview");
    expect(
      voiceCaptionMode({
        edition: "local",
        provider: "groq",
        livePcmSupported: false,
      }),
    ).toBe("chunked-preview");
  });

  it("falls back to chunked preview when live PCM is unavailable", () => {
    expect(
      voiceCaptionMode({
        edition: "cloud",
        provider: "transcribe",
        livePcmSupported: false,
      }),
    ).toBe("chunked-preview");
  });
});

describe("voiceProviderLabel", () => {
  it("names the chosen vendor without implying the other", () => {
    expect(voiceProviderLabel("groq")).toBe("Groq Whisper");
    expect(voiceProviderDestination("groq")).toMatch(/Amazon Transcribe is not used/);
    expect(voiceProviderLabel("transcribe")).toBe("Amazon Transcribe");
    expect(voiceProviderDestination("transcribe")).toMatch(/Groq is not used/);
  });
});

describe("pcmFromWav", () => {
  it("round-trips 16-bit mono PCM", () => {
    const pcm = Buffer.from([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
    const wav = encodePcm16Wav(pcm, 16_000);
    const parsed = pcmFromWav(wav);
    expect(parsed?.sampleRate).toBe(16_000);
    expect(parsed?.pcm.equals(pcm)).toBe(true);
  });

  it("rejects non-WAV bytes", () => {
    expect(pcmFromWav(Buffer.from("webm-not-wav"))).toBeNull();
  });
});
