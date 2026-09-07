/**
 * In-process record of Bedrock ids this account cannot invoke.
 * Filled from Models → Test or chat when AWS returns "not available for this
 * account". Catalog omits them (they are not a console toggle). Not persisted
 * — a restart re-probes. Never an inference call.
 */

const denied = new Set<string>();

function aliases(modelId: string): string[] {
  const id = modelId.trim();
  if (!id) return [];
  const stripped = id.replace(/^(us|eu|apac|global)\./i, "");
  return stripped === id ? [id] : [id, stripped];
}

export function rememberBedrockNotEntitled(modelId: string): void {
  for (const a of aliases(modelId)) denied.add(a);
}

export function isBedrockIdDenied(modelId: string, foundationModelId?: string): boolean {
  if (denied.has(modelId)) return true;
  if (foundationModelId && denied.has(foundationModelId)) return true;
  for (const a of aliases(modelId)) {
    if (denied.has(a)) return true;
  }
  return false;
}

export function clearBedrockNotEntitledForTests(): void {
  denied.clear();
}
