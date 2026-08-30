/**
 * First-run wizard storage preference. Shared by the client wizard and setup APIs.
 * Does not provision databases — it only records a choice.
 *
 * Cloud is DynamoDB only. Neon/Aurora stay parked as a possible later SQL path.
 * Local default is Postgres; DynamoDB is an optional lab preference.
 */

export type WizardStorageChoice = "postgres" | "dynamodb";

export type RuntimeEdition = "local" | "cloud";

export function parseWizardStorage(
  raw: string | null | undefined,
  edition: RuntimeEdition,
  localFallback: "postgres" | "dynamodb",
): WizardStorageChoice {
  if (edition === "cloud") return "dynamodb";
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "dynamodb" || v === "postgres") return v;
  return localFallback;
}

export function isValidWizardStorage(
  backend: unknown,
  edition: RuntimeEdition,
): backend is WizardStorageChoice {
  if (edition === "cloud") return backend === "dynamodb";
  return backend === "postgres" || backend === "dynamodb";
}
