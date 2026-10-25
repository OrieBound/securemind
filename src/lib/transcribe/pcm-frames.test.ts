import { describe, expect, it } from "vitest";
import { splitPcmFrames, TRANSCRIBE_FRAME_BYTES } from "./pcm-wav";

async function collect(chunks: Uint8Array[], max?: number) {
  async function* src() {
    for (const c of chunks) yield c;
  }
  const out: Uint8Array[] = [];
  for await (const f of splitPcmFrames(src(), max)) out.push(f);
  return out;
}

const bytes = (n: number, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i) % 251);
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

describe("splitPcmFrames", () => {
  it("cuts one huge chunk into frames no larger than the limit, losing nothing", async () => {
    const big = bytes(600 * 1024); // a whole recording arriving at once
    const frames = await collect([big]);
    expect(Math.max(...frames.map(f => f.byteLength))).toBeLessThanOrEqual(TRANSCRIBE_FRAME_BYTES);
    expect(frames.reduce((n, f) => n + f.byteLength, 0)).toBe(big.byteLength);
    expect(join(frames)).toEqual(big);
  });

  it("leaves small chunks as they are and skips empty ones", async () => {
    const frames = await collect([bytes(100), new Uint8Array(0), bytes(200)]);
    expect(frames.map(f => f.byteLength)).toEqual([100, 200]);
  });

  it("never splits a 16-bit sample, even when chunks end on an odd byte", async () => {
    const all = bytes(1001);
    const frames = await collect([all.subarray(0, 333), all.subarray(333, 700), all.subarray(700)], 64);
    for (const f of frames.slice(0, -1)) expect(f.byteLength % 2).toBe(0);
    expect(join(frames)).toEqual(all);
    expect(Math.max(...frames.map(f => f.byteLength))).toBeLessThanOrEqual(64);
  });

  it("rounds an odd limit down to a whole sample", async () => {
    const frames = await collect([bytes(100)], 33);
    expect(Math.max(...frames.map(f => f.byteLength))).toBe(32);
  });
});
