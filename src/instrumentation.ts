/**
 * Runs once when the Next.js server starts (not in the browser, not for the edge runtime).
 *
 * On the hosted edition the instance encryption key and the first-run setup code live in
 * AWS Systems Manager Parameter Store (APP_SECRETS_PARAM, or the older Secrets Manager
 * APP_SECRETS_ARN) instead of plain Amplify environment variables.
 * This loads them into the process before the first request. It does nothing when
 * neither is set, which is every local and on-prem install.
 *
 * If the store cannot be reached we log and carry on rather than refuse to boot: the
 * app then fails closed. Without the encryption key it cannot read or write stored vendor
 * keys, and without the setup code nobody can claim the instance.
 */

const ATTEMPTS = 3;
const BACKOFF_MS = 400;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` imports server code to collect page data. It has no secrets to load.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.APP_SECRETS_PARAM?.trim() && !process.env.APP_SECRETS_ARN?.trim()) return;

  const { ensureRuntimeEnvFromSecrets } = await import("@/lib/aws-secrets");
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await ensureRuntimeEnvFromSecrets();
      return;
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      console.error(`[startup] could not load app secrets (attempt ${attempt}/${ATTEMPTS}): ${name}`);
      if (attempt < ATTEMPTS) await new Promise(resolve => setTimeout(resolve, BACKOFF_MS * attempt));
    }
  }
}
