/**
 * Browser: stream the microphone straight to Amazon Transcribe over a WebSocket, so words appear
 * while you speak. The page asks our server for a short-lived signed address
 * (POST /api/transcribe/live-session) and then talks to Amazon itself; the audio never passes
 * through our server. Same handle as `startCloudLiveStt`, so the composer treats both alike.
 *
 * Audio is 16 kHz mono PCM, sent in the AWS event-stream format (see event-stream.ts). Nothing here
 * keeps the signed address after the connection opens, and the address is never logged.
 */

import { captionsFromMessage, decodeMessage, encodeAudioEvent } from "./event-stream";
import { downsample, floatToInt16, TARGET_RATE, type CloudLiveSttHandle } from "./live-client";

/** After Done, how long to wait for Amazon to send the last words and close the connection. */
const FINISH_TIMEOUT_MS = 8_000;
/**
 * Longest one session may run. Each session is counted toward the cost cap as a flat estimate
 * when it starts (voice-usage.ts), so the browser stops sending audio after this.
 */
export const MAX_SESSION_MS = 10 * 60_000;

type Session = { url: string; sampleRate: number };

async function fetchSession(signal: AbortSignal): Promise<Session> {
  const res = await fetch("/api/transcribe/live-session", { method: "POST", credentials: "same-origin", signal });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Live captions unavailable (${res.status})`);
  }
  const body = (await res.json()) as Partial<Session>;
  if (typeof body.url !== "string" || !body.url.startsWith("wss://")) throw new Error("Live captions unavailable");
  return { url: body.url, sampleRate: body.sampleRate ?? TARGET_RATE };
}

export function startDirectLiveStt(opts: {
  ctx: AudioContext;
  stream: MediaStream;
  onCaption: (stable: string, interim: string) => void;
  signal?: AbortSignal;
}): CloudLiveSttHandle {
  const source = opts.ctx.createMediaStreamSource(opts.stream);
  const processor = opts.ctx.createScriptProcessor(4096, 1, 1);
  const mute = opts.ctx.createGain();
  mute.gain.value = 0;

  const abort = new AbortController();
  opts.signal?.addEventListener("abort", () => abort.abort(), { once: true });

  let stable = "";
  let interim = "";
  let closed = false; // the mic side has stopped (Done or cancel)
  let socket: WebSocket | null = null;
  let failure: Error | null = null;
  const queued: Uint8Array[] = []; // audio captured before the connection opened

  let settle!: () => void;
  const finished = new Promise<void>(resolve => {
    settle = resolve;
  });

  const send = (pcm: Uint8Array) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(encodeAudioEvent(pcm));
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error("Live captions stopped");
      }
    } else if (!failure) {
      queued.push(pcm);
    }
  };

  const sessionTimer = setTimeout(() => {
    stopMic();
    endStream();
  }, MAX_SESSION_MS);

  processor.onaudioprocess = ev => {
    if (closed) return;
    const input = ev.inputBuffer.getChannelData(0);
    send(floatToInt16(downsample(input, opts.ctx.sampleRate, TARGET_RATE)));
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(opts.ctx.destination);

  const handleMessage = (data: ArrayBuffer) => {
    const msg = decodeMessage(new Uint8Array(data));
    if (!msg) return;
    for (const cap of captionsFromMessage(msg)) {
      if (cap.kind === "error") {
        failure ??= new Error("Transcription failed");
      } else if (cap.kind === "final") {
        stable = stable ? `${stable} ${cap.text}` : cap.text;
        interim = "";
        opts.onCaption(stable, "");
      } else {
        interim = cap.text;
        opts.onCaption(stable, cap.text);
      }
    }
  };

  void fetchSession(abort.signal)
    .then(session => {
      if (abort.signal.aborted) return;
      const ws = new WebSocket(session.url);
      ws.binaryType = "arraybuffer";
      socket = ws;
      ws.onopen = () => {
        for (const pcm of queued.splice(0)) send(pcm);
        // Done was pressed while connecting: the queue is flushed, so end the stream now.
        if (closed) endStream();
      };
      ws.onmessage = ev => {
        if (ev.data instanceof ArrayBuffer) handleMessage(ev.data);
      };
      ws.onerror = () => {
        failure ??= new Error("Live captions could not connect");
      };
      ws.onclose = ev => {
        // 1000 is a clean close. Anything else while still recording is a failure; after Done it only
        // counts as one if nothing was heard, so the whole-recording pass can take over.
        if (ev.code !== 1000 && (!closed || !(stable || interim))) failure ??= new Error("Live captions stopped");
        settle();
      };
    })
    .catch(err => {
      if (abort.signal.aborted) {
        settle();
        return;
      }
      failure = err instanceof Error ? err : new Error("Live captions unavailable");
      settle();
    });

  function endStream() {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(encodeAudioEvent(new Uint8Array(0)));
    } catch {
      /* the close handler reports it */
    }
  }

  function stopMic() {
    if (closed) return;
    closed = true;
    clearTimeout(sessionTimer);
    processor.disconnect();
    mute.disconnect();
    source.disconnect();
  }

  return {
    async finish(): Promise<string> {
      stopMic();
      endStream();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        finished,
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, FINISH_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
      try {
        socket?.close(1000);
      } catch {
        /* already closed */
      }
      if (failure) throw failure;
      // Words Amazon has not yet marked final still count; they are what the user saw on screen.
      return `${stable} ${interim}`.trim();
    },
    abort() {
      stopMic();
      abort.abort();
      queued.length = 0;
      try {
        socket?.close(1000);
      } catch {
        /* already closed */
      }
      settle();
    },
  };
}
