/** First-run workspace identity — same name as the local seed. */

export const DEFAULT_WORKSPACE_NAME = "Mindy Locke";
export const DEFAULT_WORKSPACE_EMOJI = "🛡️";
export const DEFAULT_WORKSPACE_COLOR = "#6366f1";
export const DEFAULT_WORKSPACE_DESCRIPTION =
  "Runbooks, incidents, architecture, and operational knowledge.";

/** Prior default names — renamed once so existing rows pick up the new identity. */
export const LEGACY_DEFAULT_NAMES = ["Cloud Operations", "Aegis", "My Workspace"] as const;

export function defaultWorkspaceHello(name: string): string {
  return (
    `Hi — I'm **${name}**, your first workspace.\n\n` +
    `Feel free to change my name anytime in **Workspace** settings. ` +
    `When you're ready, upload Knowledge or ask a question — I'll stay grounded in what you add here.`
  );
}
