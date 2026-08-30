/**
 * First-run wizard storage preference. Shared by the client wizard and setup APIs.
 * Does not provision databases — it only records a choice.
 */

export type WizardStorageChoice = "postgres" | "dynamodb" | "neon" | "aurora";

export type RuntimeEdition = "local" | "cloud";

export function parseWizardStorage(
  raw: string | null | undefined,
  edition: RuntimeEdition,
  localFallback: "postgres" | "dynamodb",
): WizardStorageChoice {
  const v = (raw ?? "").toLowerCase().trim();
  if (edition === "cloud") {
    if (v === "neon" || v === "aurora" || v === "dynamodb") return v;
    return "dynamodb";
  }
  if (v === "dynamodb" || v === "postgres") return v;
  return localFallback;
}

export function isValidWizardStorage(
  backend: unknown,
  edition: RuntimeEdition,
): backend is WizardStorageChoice {
  if (edition === "cloud") {
    return backend === "dynamodb" || backend === "neon" || backend === "aurora";
  }
  return backend === "postgres" || backend === "dynamodb";
}
