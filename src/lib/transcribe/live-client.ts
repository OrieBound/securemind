/**
 * Browser: tap the mic as 16 kHz mono PCM and stream it to /api/transcribe/live.
 * Chromium `fetch` duplex only — Safari falls back to record-then-Done.
 */

export const TARGET_RATE = 16_000;

export type LiveCaption = { kind: "partial" | "final" | "error"; text: string };

export function supportsLivePcmUpload(): boolean {
  try {
    // duplex request bodies are Chromium. Safari throws.
    new Request("http://127.0.0.1/live", {
      method: "POST",
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
    return true;
  } catch {
    return false;
  }
}

export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
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

export function floatToInt16(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export type CloudLiveSttHandle = {
  /** Close the mic PCM stream and wait for Amazon Transcribe finals. */
  finish: () => Promise<string>;
  abort: () => void;
};

export function startCloudLiveStt(opts: {
  ctx: AudioContext;
  stream: MediaStream;
  onCaption: (stable: string, interim: string) => void;
  signal?: AbortSignal;
}): CloudLiveSttHandle {
  const source = opts.ctx.createMediaStreamSource(opts.stream);
  const processor = opts.ctx.createScriptProcessor(4096, 1, 1);
  const mute = opts.ctx.createGain();
  mute.gain.value = 0;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;

  processor.onaudioprocess = ev => {
    if (closed) return;
    const input = ev.inputBuffer.getChannelData(0);
    const resampled = downsample(input, opts.ctx.sampleRate, TARGET_RATE);
    const pcm = floatToInt16(resampled);
    void writer.write(pcm).catch(() => {});
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(opts.ctx.destination);

  let stable = "";
  const abort = new AbortController();
  opts.signal?.addEventListener("abort", () => abort.abort(), { once: true });

  const responseP = fetch("/api/transcribe/live", {
    method: "POST",
    body: readable,
    duplex: "half",
    headers: { "Content-Type": "application/octet-stream" },
    signal: abort.signal,
    credentials: "same-origin",
  } as RequestInit).then(async res => {
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `Live transcription failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: LiveCaption;
        try {
          ev = JSON.parse(line) as LiveCaption;
        } catch {
          continue;
        }
        if (ev.kind === "error") throw new Error(ev.text || "Transcription failed");
        if (ev.kind === "final") {
          stable = stable ? `${stable} ${ev.text}` : ev.text;
          opts.onCaption(stable, "");
        } else {
          opts.onCaption(stable, ev.text);
        }
      }
    }
    return stable;
  });

  async function finish(): Promise<string> {
    if (!closed) {
      closed = true;
      processor.disconnect();
      mute.disconnect();
      source.disconnect();
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
    try {
      return (await responseP).trim();
    } catch (err) {
      if (abort.signal.aborted) return stable.trim();
      throw err;
    }
  }

  return {
    finish,
    abort: () => {
      closed = true;
      abort.abort();
      processor.disconnect();
      mute.disconnect();
      source.disconnect();
      void writer.close().catch(() => {});
    },
  };
}
