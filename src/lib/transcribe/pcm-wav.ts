/**
 * 16-bit PCM WAV helpers. The browser encodes the recording; the server strips
 * the header before Amazon Transcribe Streaming (which wants raw PCM).
 */

const SAMPLE_RATE = 16_000;

export function wavSampleRate(): number {
  return SAMPLE_RATE;
}

/** Parse a canonical 44-byte PCM WAV written by `encodePcm16Wav`. */
export function pcmFromWav(buf: Buffer): { pcm: Buffer; sampleRate: number } | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  const audioFormat = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) return null;
  // Walk chunks in case extra metadata sits before data.
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === "data") {
      const pcm = buf.subarray(dataStart, Math.min(dataStart + size, buf.length));
      if (pcm.length < 2) return null;
      return { pcm: Buffer.from(pcm), sampleRate };
    }
    offset = dataStart + size + (size % 2);
  }
  return null;
}

export function encodePcm16Wav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Amazon Transcribe rejects a single audio frame that is too large ("Your stream is too big"). */
export const TRANSCRIBE_FRAME_BYTES = 8 * 1024;

/**
 * Re-cut a stream of 16-bit PCM into frames of at most `maxBytes`, never splitting a sample.
 * The hosted server can receive the whole recording as one large chunk, so frames cannot be assumed
 * to arrive small. Empty chunks are skipped, and an odd trailing byte waits for the next chunk.
 */
export async function* splitPcmFrames(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes = TRANSCRIBE_FRAME_BYTES,
): AsyncGenerator<Uint8Array> {
  const frame = maxBytes - (maxBytes % 2);
  let carry: Uint8Array | null = null;
  for await (const incoming of chunks) {
    if (incoming.byteLength === 0) continue;
    let data = incoming;
    if (carry) {
      const joined = new Uint8Array(carry.byteLength + incoming.byteLength);
      joined.set(carry, 0);
      joined.set(incoming, carry.byteLength);
      data = joined;
      carry = null;
    }
    const usable = data.byteLength - (data.byteLength % 2);
    for (let i = 0; i < usable; i += frame) {
      yield data.subarray(i, Math.min(i + frame, usable));
    }
    if (usable < data.byteLength) carry = data.subarray(usable);
  }
  if (carry && carry.byteLength > 0) yield carry;
}
