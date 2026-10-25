/**
 * The AWS event-stream wire format that Amazon Transcribe Streaming speaks over a WebSocket.
 *
 * Each WebSocket frame is one message: a 12-byte prelude (total length, header length, a CRC of
 * those eight bytes), the headers, the payload, and a CRC of everything before it. Written by hand
 * so the browser bundle stays small; it is covered by tests, including the standard CRC-32 vector.
 * Runs in the browser and in Node. It carries audio and captions only, never credentials.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const HEADER_TYPE_STRING = 7;
const PRELUDE_BYTES = 12;
/** Transcribe refuses a single audio message larger than this. */
export const MAX_AUDIO_MESSAGE_BYTES = 32 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeHeaders(headers: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    if (n.length > 255 || v.length > 0xffff) throw new Error("event-stream header too long");
    const part = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    let o = 0;
    part[o++] = n.length;
    part.set(n, o);
    o += n.length;
    part[o++] = HEADER_TYPE_STRING;
    part[o++] = (v.length >>> 8) & 0xff;
    part[o++] = v.length & 0xff;
    part.set(v, o);
    parts.push(part);
  }
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array {
  const headerBytes = encodeHeaders(headers);
  const total = PRELUDE_BYTES + headerBytes.length + payload.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headerBytes.length);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  out.set(headerBytes, PRELUDE_BYTES);
  out.set(payload, PRELUDE_BYTES + headerBytes.length);
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}

/** One chunk of 16-bit PCM audio. An empty payload tells Transcribe the audio has ended. */
export function encodeAudioEvent(pcm: Uint8Array): Uint8Array {
  if (pcm.length > MAX_AUDIO_MESSAGE_BYTES) throw new Error("audio message too large");
  return encodeMessage(
    {
      ":content-type": "application/octet-stream",
      ":event-type": "AudioEvent",
      ":message-type": "event",
    },
    pcm,
  );
}

export type DecodedMessage = {
  headers: Record<string, string>;
  payload: Uint8Array;
};

/** Returns null for anything malformed, including a CRC mismatch. Never throws. */
export function decodeMessage(data: Uint8Array): DecodedMessage | null {
  if (data.length < PRELUDE_BYTES + 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const total = view.getUint32(0);
  const headerLen = view.getUint32(4);
  if (total !== data.length || PRELUDE_BYTES + headerLen + 4 > total) return null;
  if (view.getUint32(8) !== crc32(data.subarray(0, 8))) return null;
  if (view.getUint32(total - 4) !== crc32(data.subarray(0, total - 4))) return null;

  const headers: Record<string, string> = {};
  let o = PRELUDE_BYTES;
  const end = PRELUDE_BYTES + headerLen;
  while (o < end) {
    const nameLen = data[o++]!;
    if (o + nameLen + 1 > end) return null;
    const name = decoder.decode(data.subarray(o, o + nameLen));
    o += nameLen;
    const type = data[o++]!;
    if (type === HEADER_TYPE_STRING || type === 6) {
      // 7 = string, 6 = byte array: both carry a 2-byte length.
      if (o + 2 > end) return null;
      const len = view.getUint16(o);
      o += 2;
      if (o + len > end) return null;
      if (type === HEADER_TYPE_STRING) headers[name] = decoder.decode(data.subarray(o, o + len));
      o += len;
    } else {
      // Fixed-size types: true/false carry nothing, the rest 1, 2, 4, 8 or 16 bytes.
      const sizes: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 };
      const size = sizes[type];
      if (size === undefined || o + size > end) return null;
      o += size;
    }
  }
  return { headers, payload: data.subarray(end, total - 4) };
}

export type TranscriptCaption =
  | { kind: "partial" | "final"; text: string }
  | { kind: "error"; text: string };

/**
 * Turn one message from Transcribe into captions. An exception message becomes an `error` caption
 * carrying only the exception's type name, never its detail, so nothing odd is shown or logged.
 */
export function captionsFromMessage(msg: DecodedMessage): TranscriptCaption[] {
  const type = msg.headers[":message-type"];
  if (type === "exception") {
    return [{ kind: "error", text: msg.headers[":exception-type"] || "Transcription failed" }];
  }
  if (type !== "event" || msg.headers[":event-type"] !== "TranscriptEvent") return [];
  let body: { Transcript?: { Results?: Array<{ IsPartial?: boolean; Alternatives?: Array<{ Transcript?: string }> }> } };
  try {
    body = JSON.parse(decoder.decode(msg.payload));
  } catch {
    return [];
  }
  const out: TranscriptCaption[] = [];
  for (const result of body.Transcript?.Results ?? []) {
    const text = result.Alternatives?.[0]?.Transcript?.trim();
    if (text) out.push({ kind: result.IsPartial ? "partial" : "final", text });
  }
  return out;
}
