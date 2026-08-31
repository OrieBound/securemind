/**
 * Decode a MediaRecorder blob (webm/mp4) to 16 kHz mono PCM WAV in the browser.
 * Amazon Transcribe Streaming needs raw PCM; Groq Whisper accepts the WAV too.
 */

const TARGET_RATE = 16_000;

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    const n = Math.max(1, end - start);
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / n;
  }
  return out;
}

function mixMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const mixed = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mixed[i] += data[i] / channels;
  }
  return mixed;
}

function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const bytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buf;
}

export async function recordingToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    const mono = mixMono(decoded);
    const resampled = downsample(mono, decoded.sampleRate, TARGET_RATE);
    return new Blob([encodeWav(resampled, TARGET_RATE)], { type: "audio/wav" });
  } finally {
    await ctx.close().catch(() => {});
  }
}
