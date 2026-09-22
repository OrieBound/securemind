/** Non-secret instance settings, following the pricing override storage path. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hostedInstanceConfig } from "@/lib/instance-config-hosted";
import { isHostedRuntime } from "@/lib/runtime-env";
import { getInstanceAwsStatus, resolveRuntimeSecrets } from "@/lib/instance-config";
import { selectGroqApiKey } from "./groq";
import { resolveVendorApiKey } from "./vendor-secrets";
import type { CatalogModel } from "./catalog-shared";
import { modelKey, type ModelAvailabilityMap, type ModelAvailabilityRecord } from "./model-availability";

function filePath() {
  // Compose mounts /data and places INSTANCE_KEY_FILE there. Keep these
  // non-secret settings on the same persistent volume, outside the app image.
  const keyFile = process.env.INSTANCE_KEY_FILE?.trim();
  return join(keyFile ? dirname(keyFile) : ".data", "model-availability.json");
}

export async function getModelAvailability(): Promise<ModelAvailabilityMap> {
  if (isHostedRuntime()) {
    return ((await hostedInstanceConfig().get())?.modelAvailability ?? {}) as ModelAvailabilityMap;
  }
  try {
    return JSON.parse(readFileSync(filePath(), "utf8")) as ModelAvailabilityMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();
export function patchModelAvailability(
  model: Pick<CatalogModel, "provider" | "id">,
  patch: ModelAvailabilityRecord,
  userId: string,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    const records = await getModelAvailability();
    const key = modelKey(model);
    records[key] = { ...records[key], ...patch };
    if (isHostedRuntime()) {
      await hostedInstanceConfig().merge({ modelAvailability: records, updatedByUserId: userId });
    } else {
      const file = filePath();
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(records), "utf8");
      renameSync(temporary, file);
    }
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

/** Fingerprints never leave the server. A changed key/account invalidates its checks. */
export async function modelCredentialScope(provider: CatalogModel["provider"]): Promise<string> {
  let material: unknown;
  if (provider === "bedrock") {
    const aws = await getInstanceAwsStatus();
    material = [aws.profile, aws.region, aws.caller?.accountId, aws.caller?.roleName];
  } else if (provider === "ollama") {
    material = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  } else if (provider === "groq") {
    material = selectGroqApiKey(await resolveRuntimeSecrets());
  } else {
    material = await resolveVendorApiKey(provider);
  }
  return createHash("sha256").update(JSON.stringify([provider, material])).digest("hex");
}
