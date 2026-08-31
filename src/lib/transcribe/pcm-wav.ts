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
