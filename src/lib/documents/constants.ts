/** Shared document upload limits and format labels (safe for client + server). */

export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** Max files attached on a single chat turn. */
export const MAX_ATTACHMENTS_PER_TURN = 8;

/**
 * Max characters of each attachment injected into the chat prompt / history.
 * Keeps cloud providers (notably Groq) under request-size limits.
 * Full text still lives in Knowledge for retrieval.
 */
export const MAX_ATTACHMENT_PROMPT_CHARS = 12_000;

/** Soft guidance shown in the composer. */
export const ATTACHMENT_LIMITS_HINT =
  `Up to ${MAX_ATTACHMENTS_PER_TURN} files · ${MAX_FILE_MB} MB each · PDF, DOCX, XLSX, CSV, TXT, MD, JSON, images, code · long files are summarized for this chat (full text stays in Knowledge)`;

export const DOC_ACCEPT_ATTR =
  ".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.xls,.py,.js,.ts,.tsx,.jsx,.yaml,.yml,.toml,.sh,.go,.rs,.png,.jpg,.jpeg,.webp,.gif,image/*";

export const COMPOSER_ACCEPT_ATTR =
  "image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx,.py,.js,.ts,.tsx,.jsx,.yaml,.yml";

export const SUPPORTED_DOC_FORMATS_SHORT =
  "PDF, DOCX, XLSX, CSV, TXT, MD, JSON, images, and code files";
