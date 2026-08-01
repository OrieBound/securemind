/** Shared document upload limits and format labels (safe for client + server). */

export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export const DOC_ACCEPT_ATTR =
  ".txt,.md,.csv,.json,.pdf,.py,.js,.ts,.tsx,.jsx,.yaml,.yml,.toml,.sh,.go,.rs";

export const SUPPORTED_DOC_FORMATS_SHORT =
  "PDF, TXT, MD, CSV, JSON, and code files";
