/**
 * First-run wizard storage preference. Shared by the client wizard and setup APIs.
 * Does not provision databases — it only records a choice.
 *
 * Cloud is DynamoDB only. Neon/Aurora stay parked as a possible later SQL path.
 * Local / Docker setup uses Postgres only. Old preferences cannot override the edition.
 */

export type WizardStorageChoice = "postgres" | "dynamodb";

export type RuntimeEdition = "local" | "cloud";

export function parseWizardStorage(
  _raw: string | null | undefined,
  edition: RuntimeEdition,
  _localFallback: "postgres" | "dynamodb",
): WizardStorageChoice {
  if (edition === "cloud") return "dynamodb";
  return "postgres";
}

export function isValidWizardStorage(
  backend: unknown,
  edition: RuntimeEdition,
): backend is WizardStorageChoice {
  if (edition === "cloud") return backend === "dynamodb";
  return backend === "postgres";
}
