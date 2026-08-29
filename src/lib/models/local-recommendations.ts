/**
 * Local Ollama recommendations. These tags are a catalog of suggestions —
 * not a permanent router hard-code. Operators may use any installed chat model.
 */

import { cpus, totalmem } from "node:os";
import { spawnSync } from "node:child_process";

export const LOCAL_MODEL_PREFERRED = "llama3.2:3b";
export const LOCAL_MODEL_ENHANCED = "gemma3:4b";
export const LOCAL_MODEL_LIGHTWEIGHT = "llama3.2:1b";
export const LOCAL_EMBED_MODEL = "nomic-embed-text";

/** Models the UI may offer to `ollama pull`. Anything else must be pulled in a terminal. */
export const OLLAMA_PULL_ALLOWLIST = [
  LOCAL_MODEL_PREFERRED,
  LOCAL_MODEL_ENHANCED,
  LOCAL_MODEL_LIGHTWEIGHT,
  "llama3.2",
  "llama3.2:latest",
  LOCAL_EMBED_MODEL,
] as const;

export const LOCAL_QUALITY_NOTE =
  "Local-model speed and answer quality depend on this machine and the model you choose. " +
  "A small locally running model will not match premium hosted models.";

export const REMOTE_INFERENCE_NOTE =
  "Remote inference may incur cost and sends sanitized application content to the provider, " +
  "outside this installation.";

export type HardwareSnapshot = {
  cpuCount: number;
  totalMemGb: number;
  gpuName: string | null;
  gpuVramMb: number | null;
};

export type LocalModelRecommendation = {
  primary: string;
  enhanced: string | null;
  lightweight: string;
  reason: string;
  /** Installed chat tag to use now — never triggers a download. */
  useInstalled: string | null;
};

export function normalizeOllamaTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/:latest$/, "");
}

/** Tags still needed so Docker init / guided pull can skip weights already on disk. */
export function missingOllamaModels(installedTags: string[], wanted: string[]): string[] {
  const have = new Set(installedTags.map(normalizeOllamaTag));
  return wanted.filter(w => !have.has(normalizeOllamaTag(w)));
}

export function isAllowedOllamaPull(tag: string): boolean {
  const n = normalizeOllamaTag(tag);
  return OLLAMA_PULL_ALLOWLIST.some(allowed => normalizeOllamaTag(allowed) === n);
}

export function isOllamaChatTag(tag: string): boolean {
  return !/embed/i.test(tag);
}

/** Prefer already-installed compatible chat models before suggesting a download. */
export function pickInstalledChatModel(
  installedTags: string[],
  hardware?: Pick<HardwareSnapshot, "gpuVramMb">,
): string | null {
  const chat = installedTags.filter(isOllamaChatTag);
  if (chat.length === 0) return null;
  const cpuBound = hardware?.gpuVramMb == null || hardware.gpuVramMb < 4096;
  const preferred = cpuBound
    ? [LOCAL_MODEL_LIGHTWEIGHT, LOCAL_MODEL_PREFERRED, "llama3.2", LOCAL_MODEL_ENHANCED]
    : [LOCAL_MODEL_PREFERRED, "llama3.2", LOCAL_MODEL_LIGHTWEIGHT, LOCAL_MODEL_ENHANCED];
  for (const want of preferred) {
    const hit = chat.find(t => normalizeOllamaTag(t) === normalizeOllamaTag(want));
    if (hit) return hit;
  }
  return chat[0] ?? null;
}

export function probeCpuRam(): Pick<HardwareSnapshot, "cpuCount" | "totalMemGb"> {
  return {
    cpuCount: Math.max(1, cpus().length),
    totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
  };
}

/** Best-effort NVIDIA probe. Missing driver / no GPU is not an error. */
export function probeNvidiaGpu(timeoutMs = 1500): Pick<HardwareSnapshot, "gpuName" | "gpuVramMb"> {
  try {
    const result = spawnSync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
    );
    if (result.status !== 0 || !result.stdout?.trim()) {
      return { gpuName: null, gpuVramMb: null };
    }
    const line = result.stdout.trim().split(/\r?\n/)[0] ?? "";
    const [nameRaw, memRaw] = line.split(",").map(s => s.trim());
    const vramMb = Number(memRaw);
    return {
      gpuName: nameRaw || null,
      gpuVramMb: Number.isFinite(vramMb) ? vramMb : null,
    };
  } catch {
    return { gpuName: null, gpuVramMb: null };
  }
}

export function probeHardware(): HardwareSnapshot {
  return { ...probeCpuRam(), ...probeNvidiaGpu() };
}

/**
 * Recommend a pull target when no compatible chat model is installed.
 * Primary is always a relatively small general-purpose tag; enhanced is optional.
 */
export function recommendLocalModels(
  hardware: HardwareSnapshot,
  installedTags: string[] = [],
): LocalModelRecommendation {
  const useInstalled = pickInstalledChatModel(installedTags, hardware);
  const constrained =
    hardware.totalMemGb > 0 &&
    hardware.totalMemGb < 8 &&
    (hardware.gpuVramMb == null || hardware.gpuVramMb < 4096);
  const capable =
    hardware.totalMemGb >= 16 ||
    (hardware.gpuVramMb != null && hardware.gpuVramMb >= 6144);

  if (useInstalled) {
    return {
      primary: LOCAL_MODEL_PREFERRED,
      enhanced: capable ? LOCAL_MODEL_ENHANCED : null,
      lightweight: LOCAL_MODEL_LIGHTWEIGHT,
      reason: `Using installed model ${useInstalled}. Nothing will be downloaded unless you choose another model.`,
      useInstalled,
    };
  }

  if (constrained) {
    return {
      primary: LOCAL_MODEL_LIGHTWEIGHT,
      enhanced: null,
      lightweight: LOCAL_MODEL_LIGHTWEIGHT,
      reason:
        `This machine reports about ${hardware.totalMemGb} GB RAM` +
        (hardware.gpuName ? ` and GPU ${hardware.gpuName}` : " without usable GPU memory") +
        `. ${LOCAL_MODEL_LIGHTWEIGHT} is the lightest supported starting point.`,
      useInstalled: null,
    };
  }

  return {
    primary: LOCAL_MODEL_PREFERRED,
    enhanced: capable ? LOCAL_MODEL_ENHANCED : hardware.totalMemGb >= 12 ? LOCAL_MODEL_ENHANCED : null,
    lightweight: LOCAL_MODEL_LIGHTWEIGHT,
    reason: capable
      ? `About ${hardware.totalMemGb} GB RAM` +
        (hardware.gpuVramMb ? ` and ${Math.round(hardware.gpuVramMb / 1024)} GB GPU memory` : "") +
        `. ${LOCAL_MODEL_PREFERRED} is the default; ${LOCAL_MODEL_ENHANCED} is an optional stronger local model.`
      : `${LOCAL_MODEL_PREFERRED} is a lightweight general-purpose starting point when hardware is unknown.`,
    useInstalled: null,
  };
}
