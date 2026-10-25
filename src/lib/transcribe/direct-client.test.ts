import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeMessage, encodeMessage } from "./event-stream";
import { MAX_SESSION_MS, startDirectLiveStt } from "./direct-client";

const enc = new TextEncoder();

function transcriptMessage(text: string, partial: boolean): ArrayBuffer {
  const body = { Transcript: { Results: [{ IsPartial: partial, Alternatives: [{ Transcript: text }] }] } };
  const m = encodeMessage({ ":message-type": "event", ":event-type": "TranscriptEvent" }, enc.encode(JSON.stringify(body)));
  return m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength) as ArrayBuffer;
}

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = "";
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

function fakeAudio() {
  const processor = {
    onaudioprocess: null as null | ((ev: unknown) => void),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const ctx = {
    sampleRate: 16000,
    destination: {},
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    createScriptProcessor: () => processor,
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
  };
  const feed = (samples: number[]) =>
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(samples) } });
  return { ctx: ctx as unknown as AudioContext, feed };
}

const SESSION = { url: "wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?x=1", sampleRate: 16000 };

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(SESSION)));
});
afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise(r => setTimeout(r, 0));

describe("startDirectLiveStt", () => {
  it("shows partial words as they arrive and keeps finished sentences", async () => {
    const { ctx } = fakeAudio();
    const captions: Array<[string, string]> = [];
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: (s, i) => captions.push([s, i]) });
    await flush();
    const ws = FakeSocket.instances[0]!;
    expect(ws.url).toBe(SESSION.url);
    ws.open();
    ws.onmessage!({ data: transcriptMessage("hello wor", true) });
    ws.onmessage!({ data: transcriptMessage("hello world", false) });
    ws.onmessage!({ data: transcriptMessage("how are", true) });
    expect(captions).toEqual([
      ["", "hello wor"],
      ["hello world", ""],
      ["hello world", "how are"],
    ]);
    const done = handle.finish();
    ws.onmessage!({ data: transcriptMessage("how are you", false) });
    ws.close(1000);
    expect(await done).toBe("hello world how are you");
  });

  it("holds audio captured before the connection opens, then sends it in order", async () => {
    const { ctx, feed } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    feed([0.1, 0.2, 0.3, 0.4]); // before the address has even been fetched
    await flush();
    const ws = FakeSocket.instances[0]!;
    feed([0.5, 0.6, 0.7, 0.8]); // address fetched, socket not open yet
    expect(ws.sent).toHaveLength(0);
    ws.open();
    feed([0.9, 1, 0.1, 0.2]); // live
    expect(ws.sent).toHaveLength(3);
    for (const frame of ws.sent) {
      const m = decodeMessage(frame)!;
      expect(m.headers[":event-type"]).toBe("AudioEvent");
      expect(m.payload.length).toBe(8); // 4 samples, 16-bit
    }
    handle.abort();
  });

  it("ends the stream with an empty audio message when Done is pressed", async () => {
    const { ctx } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await flush();
    const ws = FakeSocket.instances[0]!;
    ws.open();
    const done = handle.finish();
    const last = decodeMessage(ws.sent[ws.sent.length - 1]!)!;
    expect(last.payload.length).toBe(0);
    ws.close(1000);
    await done;
  });

  it("stops capturing the microphone on Done", async () => {
    const { ctx, feed } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await flush();
    const ws = FakeSocket.instances[0]!;
    ws.open();
    const done = handle.finish();
    const before = ws.sent.length;
    feed([0.1, 0.2, 0.3, 0.4]);
    expect(ws.sent.length).toBe(before);
    ws.close(1000);
    await done;
  });

  it("rejects when the server will not give an address, so the caller can fall back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Direct live captions are not set up on this install." }, { status: 404 })));
    const { ctx } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await expect(handle.finish()).rejects.toThrow("not set up");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("refuses an address that is not a secure WebSocket", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "ws://example.com/x", sampleRate: 16000 })));
    const { ctx } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await expect(handle.finish()).rejects.toThrow();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("rejects when Amazon reports an error, without showing its detail", async () => {
    const { ctx } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await flush();
    const ws = FakeSocket.instances[0]!;
    ws.open();
    const ex = encodeMessage(
      { ":message-type": "exception", ":exception-type": "BadRequestException" },
      enc.encode('{"Message":"account detail"}'),
    );
    ws.onmessage!({ data: ex.buffer.slice(ex.byteOffset, ex.byteOffset + ex.byteLength) });
    const done = handle.finish();
    ws.close(1000);
    await expect(done).rejects.toThrow("Transcription failed");
  });

  it("rejects when the connection drops with nothing heard", async () => {
    const { ctx } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await flush();
    const ws = FakeSocket.instances[0]!;
    ws.open();
    const done = handle.finish();
    ws.close(1006);
    await expect(done).rejects.toThrow();
  });

  it("keeps what was heard when the connection closes oddly after Done", async () => {
    const { ctx } = fakeAudio();
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
    await flush();
    const ws = FakeSocket.instances[0]!;
    ws.open();
    ws.onmessage!({ data: transcriptMessage("good morning", false) });
    const done = handle.finish();
    ws.close(1005);
    expect(await done).toBe("good morning");
  });

  it("ignores garbled frames", async () => {
    const { ctx } = fakeAudio();
    const captions: unknown[] = [];
    const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: (...a) => captions.push(a) });
    await flush();
    const ws = FakeSocket.instances[0]!;
    ws.open();
    ws.onmessage!({ data: new Uint8Array([1, 2, 3]).buffer });
    ws.onmessage!({ data: "text frame" });
    expect(captions).toEqual([]);
    handle.abort();
  });

  it("stops sending audio and ends the stream after the session limit", async () => {
    vi.useFakeTimers();
    try {
      const { ctx, feed } = fakeAudio();
      const handle = startDirectLiveStt({ ctx, stream: {} as MediaStream, onCaption: () => {} });
      await vi.advanceTimersByTimeAsync(0);
      const ws = FakeSocket.instances[0]!;
      ws.open();
      feed([0.1, 0.2, 0.3, 0.4]);
      await vi.advanceTimersByTimeAsync(MAX_SESSION_MS);
      const last = decodeMessage(ws.sent[ws.sent.length - 1]!)!;
      expect(last.payload.length).toBe(0); // end-of-stream sent
      const count = ws.sent.length;
      feed([0.1, 0.2, 0.3, 0.4]);
      expect(ws.sent.length).toBe(count); // mic no longer sends
      ws.close(1000);
      await handle.finish();
    } finally {
      vi.useRealTimers();
    }
  });
});
