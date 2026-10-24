/**
 * Task models: a small, Admin-approved model for a narrow job, separate from chat routing.
 *
 * Chat picks a model by complexity tier. Some jobs need a different guarantee: for example turning an
 * ordinary reply into a downloadable file when the chat model did not follow the file format. The Admin
 * picks that helper explicitly, it is OFF until they do, and it only ever runs with the model the Admin
 * chose (no fallback to another provider). Non-secret setting; stored like model availability.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { hostedInstanceConfig } from "@/lib/instance-config-hosted";
import { isHostedRuntime } from "@/lib/runtime-env";
import { getVendorConsentFlags, instanceCanUseBedrock } from "@/lib/instance-config";
import { fileOutputInstructions } from "@/lib/turn-policy/file-request";
import { parseFileInfo } from "@/lib/files/file-spec";
import { resolveAllowedModel } from "./allowlist";
import { streamChat } from "./provider";
import { FILE_REPLY_TOKENS, type ModelProvider } from "./types";

export const TASK_PURPOSES = ["fileFormat"] as const;
export type TaskPurpose = (typeof TASK_PURPOSES)[number];

export type TaskModelChoice = {
  provider: ModelProvider;
  model: string;
  setAt: string;
  setByUserId: string;
};
export type TaskModelMap = Partial<Record<TaskPurpose, TaskModelChoice>>;

export function parseTaskPurpose(v: unknown): TaskPurpose | null {
  return (TASK_PURPOSES as readonly unknown[]).includes(v) ? (v as TaskPurpose) : null;
}

function filePath() {
  const keyFile = process.env.INSTANCE_KEY_FILE?.trim();
  return join(keyFile ? dirname(keyFile) : ".data", "task-models.json");
}

/** Keep only well-formed entries for known purposes; anything else in storage is ignored. */
function clean(raw: unknown): TaskModelMap {
  const out: TaskModelMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const purpose of TASK_PURPOSES) {
    const v = (raw as Record<string, unknown>)[purpose] as Partial<TaskModelChoice> | undefined;
    if (v && typeof v.model === "string" && typeof v.provider === "string" && v.model.trim()) {
      out[purpose] = {
        provider: v.provider as ModelProvider,
        model: v.model,
        setAt: typeof v.setAt === "string" ? v.setAt : "",
        setByUserId: typeof v.setByUserId === "string" ? v.setByUserId : "",
      };
    }
  }
  return out;
}

export async function getTaskModels(): Promise<TaskModelMap> {
  if (isHostedRuntime()) return clean((await hostedInstanceConfig().get())?.taskModels);
  try {
    return clean(JSON.parse(readFileSync(filePath(), "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();
/** Set (or clear, with `null`) the helper for one purpose. */
export function setTaskModel(
  purpose: TaskPurpose,
  choice: { provider: ModelProvider; model: string } | null,
  userId: string,
): Promise<TaskModelMap> {
  const operation = writeQueue.then(async () => {
    const map = await getTaskModels();
    if (choice) map[purpose] = { ...choice, setAt: new Date().toISOString(), setByUserId: userId };
    else delete map[purpose];
    if (isHostedRuntime()) {
      await hostedInstanceConfig().merge({ taskModels: map, updatedByUserId: userId });
    } else {
      const file = filePath();
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(map), "utf8");
      renameSync(temporary, file);
    }
    return map;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

/** Why a helper cannot run right now, or null when it can. */
export async function taskModelBlockReason(provider: ModelProvider): Promise<string | null> {
  if (provider === "ollama") return null;
  if (provider === "bedrock") {
    return (await instanceCanUseBedrock()) ? null : "Amazon Bedrock is not enabled for this install.";
  }
  const flags = await getVendorConsentFlags();
  return flags.externalRiskAckAt ? null : "The vendor consent notice has not been accepted by an Admin.";
}

export type FileFormatResult =
  | { ok: true; content: string }
  | { ok: false; reason: "not_configured" | "unavailable" | "blocked" | "failed" | "no_file"; message: string };

const FORMAT_TIMEOUT_MS = 45_000;

const FORMATTER_RULES = [
  "You are a file formatter. The user message is a reply that an assistant wrote.",
  "Turn the data or document in it into the requested file. Use only what is in that reply: do not add facts, rows or sections.",
  "If the reply has nothing that can become a file, answer with one sentence and no file block.",
].join(" ");

/** Pull the first complete `file:` block out of a reply. */
export function extractFileBlock(reply: string): { name: string } | null {
  const m = /^ {0,3}(`{3,}|~{3,})\s*(file:[^\n]+)\n[\s\S]*?\n {0,3}\1\s*$/m.exec(reply);
  if (!m) return null;
  const spec = parseFileInfo(m[2]);
  return spec ? { name: m[2].slice("file:".length).trim() } : null;
}

/**
 * Ask the Admin's file-format helper to turn `text` into a file block. Returns the helper's reply
 * (a short sentence plus one `file:` block) or the reason it could not.
 */
export async function runFileFormatter(input: { text: string; ext: string | null }): Promise<FileFormatResult> {
  const choice = (await getTaskModels()).fileFormat;
  if (!choice) return { ok: false, reason: "not_configured", message: "No file helper is set." };

  const found = await resolveAllowedModel(choice.model);
  const allowed = found && found.provider === choice.provider ? found : null;
  if (!allowed) return { ok: false, reason: "unavailable", message: "The chosen helper model is not available." };

  const blocked = await taskModelBlockReason(allowed.provider);
  if (blocked) return { ok: false, reason: "blocked", message: blocked };

  let truncated = false;
  const run = async () => {
    let out = "";
    for await (const delta of streamChat({
      messages: [
        { role: "system", content: `${FORMATTER_RULES}\n\n${fileOutputInstructions({ ext: input.ext })}` },
        { role: "user", content: input.text },
      ],
      model: allowed.model,
      provider: allowed.provider,
      lockProvider: true,
      maxTokens: FILE_REPLY_TOKENS,
      onFinish: info => {
        truncated = Boolean(info.truncated);
      },
    })) {
      out += delta;
    }
    return out;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), FORMAT_TIMEOUT_MS);
      }),
    ]);
    if (truncated) return { ok: false, reason: "failed", message: "The helper ran out of room before finishing the file." };
    if (!extractFileBlock(reply)) return { ok: false, reason: "no_file", message: "The helper did not produce a file." };
    return { ok: true, content: reply.trim() };
  } catch (err) {
    const message = (err as Error).message === "timeout" ? "The helper took too long." : "The helper could not be reached.";
    return { ok: false, reason: "failed", message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
