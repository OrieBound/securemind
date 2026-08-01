/** Shared document upload limits and format labels (safe for client + server). */

export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export const DOC_ACCEPT_ATTR =
  ".txt,.md,.csv,.json,.pdf,.py,.js,.ts,.tsx,.jsx,.yaml,.yml,.toml,.sh,.go,.rs,.png,.jpg,.jpeg,.webp,.gif,image/*";

export const COMPOSER_ACCEPT_ATTR =
  "image/*,.pdf,.txt,.md,.csv,.json,.docx,.py,.js,.ts,.tsx,.jsx,.yaml,.yml";

export const SUPPORTED_DOC_FORMATS_SHORT =
  "PDF, TXT, MD, CSV, JSON, images, and code files";
