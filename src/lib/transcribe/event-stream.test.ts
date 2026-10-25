import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_MESSAGE_BYTES,
  captionsFromMessage,
  crc32,
  decodeMessage,
  encodeAudioEvent,
  encodeMessage,
} from "./event-stream";

const text = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("encode and decode", () => {
  it("round-trips headers and payload", () => {
    const msg = encodeMessage({ ":message-type": "event", ":event-type": "Thing" }, text("hello"));
    const out = decodeMessage(msg);
    expect(out).not.toBeNull();
    expect(out!.headers).toEqual({ ":message-type": "event", ":event-type": "Thing" });
    expect(new TextDecoder().decode(out!.payload)).toBe("hello");
  });

  it("builds an audio message with the three headers Transcribe expects", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const out = decodeMessage(encodeAudioEvent(pcm))!;
    expect(out.headers).toEqual({
      ":content-type": "application/octet-stream",
      ":event-type": "AudioEvent",
      ":message-type": "event",
    });
    expect(Array.from(out.payload)).toEqual([1, 2, 3, 4]);
  });

  it("encodes an empty audio message as the end-of-stream signal", () => {
    expect(decodeMessage(encodeAudioEvent(new Uint8Array(0)))!.payload.length).toBe(0);
  });

  it("refuses an audio message over Transcribe's size limit", () => {
    expect(() => encodeAudioEvent(new Uint8Array(MAX_AUDIO_MESSAGE_BYTES + 1))).toThrow();
    expect(() => encodeAudioEvent(new Uint8Array(MAX_AUDIO_MESSAGE_BYTES))).not.toThrow();
  });

  it("rejects a corrupted or truncated message instead of throwing", () => {
    const msg = encodeAudioEvent(new Uint8Array([9, 9, 9]));
    const flipped = msg.slice();
    flipped[flipped.length - 6] ^= 0xff;
    expect(decodeMessage(flipped)).toBeNull();
    const badPrelude = msg.slice();
    badPrelude[9] ^= 0xff;
    expect(decodeMessage(badPrelude)).toBeNull();
    expect(decodeMessage(msg.slice(0, msg.length - 1))).toBeNull();
    expect(decodeMessage(new Uint8Array(3))).toBeNull();
    expect(decodeMessage(new Uint8Array(0))).toBeNull();
  });

  it("skips header types it does not need", () => {
    // A hand-built message with one int32 header (type 4) before a string header.
    const name = text("n");
    const strName = text(":message-type");
    const val = text("event");
    const headers = new Uint8Array([
      name.length, ...name, 4, 0, 0, 0, 7,
      strName.length, ...strName, 7, 0, val.length, ...val,
    ]);
    const payload = text("x");
    const total = 12 + headers.length + payload.length + 4;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, total);
    view.setUint32(4, headers.length);
    view.setUint32(8, crc32(out.subarray(0, 8)));
    out.set(headers, 12);
    out.set(payload, 12 + headers.length);
    view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
    expect(decodeMessage(out)!.headers[":message-type"]).toBe("event");
  });
});

describe("captionsFromMessage", () => {
  const event = (body: unknown) =>
    decodeMessage(
      encodeMessage({ ":message-type": "event", ":event-type": "TranscriptEvent" }, text(JSON.stringify(body))),
    )!;

  it("maps partial and final results", () => {
    const body = {
      Transcript: {
        Results: [
          { IsPartial: true, Alternatives: [{ Transcript: "hello wor" }] },
          { IsPartial: false, Alternatives: [{ Transcript: " hello world " }] },
        ],
      },
    };
    expect(captionsFromMessage(event(body))).toEqual([
      { kind: "partial", text: "hello wor" },
      { kind: "final", text: "hello world" },
    ]);
  });

  it("ignores empty results and unrelated events", () => {
    expect(captionsFromMessage(event({ Transcript: { Results: [{ IsPartial: true, Alternatives: [{ Transcript: " " }] }] } }))).toEqual([]);
    expect(captionsFromMessage(event({ Transcript: { Results: [] } }))).toEqual([]);
    const other = decodeMessage(encodeMessage({ ":message-type": "event", ":event-type": "Other" }, text("{}")))!;
    expect(captionsFromMessage(other)).toEqual([]);
  });

  it("ignores a payload that is not JSON", () => {
    const bad = decodeMessage(
      encodeMessage({ ":message-type": "event", ":event-type": "TranscriptEvent" }, text("not json")),
    )!;
    expect(captionsFromMessage(bad)).toEqual([]);
  });

  it("turns an exception into an error caption naming only its type", () => {
    const ex = decodeMessage(
      encodeMessage(
        { ":message-type": "exception", ":exception-type": "BadRequestException" },
        text('{"Message":"secret detail"}'),
      ),
    )!;
    const out = captionsFromMessage(ex);
    expect(out).toEqual([{ kind: "error", text: "BadRequestException" }]);
  });
});
