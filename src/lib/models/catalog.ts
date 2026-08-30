/**
 * List text chat models available from configured providers (server-side).
 */

import {
  getInstanceAwsStatus,
  instanceCanUseBedrock,
  resolveRuntimeSecrets,
} from "@/lib/instance-config";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import { formatGroqConnectivityError } from "./groq-connectivity";
import { selectGroqApiKey } from "./groq";
import { probeOllama } from "./ollama";
import { resolveVendorApiKey } from "./vendor-secrets";
import { listOpenAIModels } from "./openai";
import { listAnthropicModels } from "./anthropic";
import { listGoogleModels } from "./google";
import { runtimeEdition } from "@/lib/runtime-env";
import { selectInvocableBedrockModels } from "./bedrock-catalog";
import {
  BEDROCK_TEXT_MODELS,
  formatBedrockCatalogError,
  modalityForListedModel,
  type CatalogModel,
  type ModelCatalogBuckets,
} from "./catalog-shared";

export type { CatalogModel } from "./catalog-shared";
export { BEDROCK_TEXT_MODELS } from "./catalog-shared";

/**
 * Live Bedrock text models for the selected profile and region.
 *
 * Filters to what this app can actually stream, using **list APIs only**:
 *  - TEXT output, streaming supported, ACTIVE lifecycle (drops LEGACY versions)
 *  - inference-profile ids when AWS publishes one (`us.*` / `global.*`)
 *
 * Never InvokeModel / Converse here. Bedrock bills tokens on inference, not
 * on ListFoundationModels / ListInferenceProfiles. A per-model availability
 * GET or a Test invoke would be a different, opt-in path.
 *
 * Models that are PROVISIONED-only are dropped — invoking one needs a
 * provisioned throughput ARN this app does not manage.
 */
async function listAllInferenceProfiles(
  client: InstanceType<typeof import("@aws-sdk/client-bedrock").BedrockClient>,
  ListInferenceProfilesCommand: typeof import("@aws-sdk/client-bedrock").ListInferenceProfilesCommand,
) {
  const summaries: NonNullable<
    import("@aws-sdk/client-bedrock").ListInferenceProfilesCommandOutput["inferenceProfileSummaries"]
  > = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListInferenceProfilesCommand({ maxResults: 200, nextToken }),
    );
    summaries.push(...(page.inferenceProfileSummaries ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return summaries;
}

async function listBedrockModels(region: string, profile: string | null): Promise<CatalogModel[]> {
  return withRealAwsEndpoints(async () => {
    const {
      BedrockClient,
      ListFoundationModelsCommand,
      ListInferenceProfilesCommand,
    } = await import("@aws-sdk/client-bedrock");
    const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers");

    const client = new BedrockClient({
      region,
      ...(profile ? { credentials: fromNodeProviderChain({ profile }) } : {}),
    });

    const listed = await client.send(new ListFoundationModelsCommand({ byOutputModality: "TEXT" }));
    const summaries = listed.modelSummaries ?? [];

    let profiles: Awaited<ReturnType<typeof listAllInferenceProfiles>> = [];
    try {
      profiles = await listAllInferenceProfiles(client, ListInferenceProfilesCommand);
    } catch {
      // Without profiles we still offer the on-demand ACTIVE subset.
    }

    return selectInvocableBedrockModels(summaries, profiles)
      .map(c => c.model)
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function listGroqModels(apiKey: string): Promise<CatalogModel[]> {
  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(formatGroqConnectivityError(err));
  }
  if (!res.ok) {
    throw new Error(formatGroqConnectivityError(new Error(`Groq models list failed (${res.status})`)));
  }
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  const rows = body.data ?? [];
  return rows
    .map(m => ({
      id: m.id,
      name: m.id.split("/").pop() ?? m.id,
      provider: "groq" as const,
      modality: modalityForListedModel(m.id),
    }))
    .filter(m => m.modality !== "other")
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listOllamaModels(): Promise<CatalogModel[]> {
  const { tags } = await probeOllama(2500);
  return tags.map(name => ({
    id: name,
    name,
    provider: "ollama" as const,
    modality: modalityForListedModel(name),
    note: modalityForListedModel(name) === "other" ? "Ollama · not for chat" : "Ollama · local",
  }));
}

export type ModelCatalog = ModelCatalogBuckets & {
  errors: string[];
};

const CATALOG_TTL_MS = 60_000;
let catalogCache: { at: number; value: ModelCatalog } | null = null;
let catalogInflight: Promise<ModelCatalog> | null = null;

/** Call after provider keys change so allowlist/catalog paths see fresh Groq models. */
export function invalidateModelCatalogCache(): void {
  catalogCache = null;
}

/**
 * Catalog with a short TTL plus in-flight coalescing. The UI, allowlist, and
 * Settings all hit `/api/models/catalog`; without this, each caller waits on
 * Groq + Ollama + Bedrock ListFoundationModels at once and the rest of the
 * app (Knowledge, nav) looks frozen.
 */
export async function getModelCatalogCached(opts?: { fresh?: boolean }): Promise<ModelCatalog> {
  const now = Date.now();
  if (!opts?.fresh && catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.value;
  }
  if (!opts?.fresh && catalogInflight) return catalogInflight;
  if (opts?.fresh) catalogCache = null;

  const pending = getModelCatalog().then(value => {
    catalogCache = { at: Date.now(), value };
    return value;
  }).finally(() => {
    if (catalogInflight === pending) catalogInflight = null;
  });
  catalogInflight = pending;
  return pending;
}

export async function getModelCatalog(): Promise<ModelCatalog> {
  const secrets = await resolveRuntimeSecrets();
  const errors: string[] = [];
  let groq: CatalogModel[] = [];
  const groqKey = selectGroqApiKey(secrets);
  if (groqKey) {
    try {
      groq = await listGroqModels(groqKey);
    } catch (err) {
      errors.push(formatGroqConnectivityError(err));
    }
  }
  const ollama = await listOllamaModels();

  let bedrock: CatalogModel[] = [];
  if (await instanceCanUseBedrock()) {
    const aws = await getInstanceAwsStatus();
    try {
      bedrock = await listBedrockModels(aws.region ?? "us-east-1", aws.profile);
    } catch (err) {
      bedrock = BEDROCK_TEXT_MODELS;
      errors.push(formatBedrockCatalogError(err, runtimeEdition()));
    }
  }

  let openai: CatalogModel[] = [];
  let anthropic: CatalogModel[] = [];
  let google: CatalogModel[] = [];

  const openaiKey = await resolveVendorApiKey("openai");
  if (openaiKey) {
    try {
      openai = await listOpenAIModels(openaiKey);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "OpenAI catalog failed");
    }
  }

  const anthropicKey = await resolveVendorApiKey("anthropic");
  if (anthropicKey) {
    try {
      anthropic = await listAnthropicModels(anthropicKey);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Anthropic catalog failed");
    }
  }

  const googleKey = await resolveVendorApiKey("google");
  if (googleKey) {
    try {
      google = await listGoogleModels(googleKey);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Google catalog failed");
    }
  }

  return { groq, bedrock, ollama, openai, anthropic, google, errors };
}
