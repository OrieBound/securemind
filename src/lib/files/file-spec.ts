/**
 * What a generated file is called and what it becomes.
 *
 * The assistant marks a file in its reply with a fenced block whose info string is `file:<name.ext>`.
 * The browser builds the file from that block when the person clicks Download. Model output is
 * untrusted (a poisoned document can steer it), so the name is cleaned, the extension must be on an
 * allowlist, and anything a browser or desktop would run on open is saved as plain text instead.
 */

export const FILE_INFO_PREFIX = "file:";

/** Largest file the browser will build. Bigger output is refused with a message. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type FileKind = "xlsx" | "csv" | "tsv" | "docx" | "md" | "text";

export type FileSpec = {
  /** Clean file name including the extension, safe to offer as a download. */
  name: string;
  ext: string;
  kind: FileKind;
  mime: string;
  /** True when an unsafe or unknown extension was replaced with .txt. */
  renamed: boolean;
};

const KIND_BY_EXT: Record<string, { kind: FileKind; mime: string }> = {
  xlsx: { kind: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { kind: "csv", mime: "text/csv" },
  tsv: { kind: "tsv", mime: "text/tab-separated-values" },
  docx: { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  md: { kind: "md", mime: "text/markdown" },
};

/** Plain text types: data, logs, configuration and source code. Saved as text, never run. */
const TEXT_EXTS = new Set([
  "txt", "log", "json", "jsonl", "ndjson", "yaml", "yml", "xml", "toml", "ini", "cfg", "conf", "properties",
  "sql", "graphql", "tf", "hcl", "dockerfile", "py", "ts", "tsx", "jsx", "java", "kt", "go", "rs", "rb", "php",
  "cs", "c", "h", "cpp", "hpp", "swift", "scala", "r", "lua", "pl", "ps1", "psm1", "sh", "bash", "zsh",
  "css", "scss", "diff", "patch", "rst", "tex", "srt", "vtt", "ics",
]);

/**
 * Types that a browser renders with script, or that Windows runs on double-click. Saved as `.txt`
 * (for example `setup.bat` becomes `setup.bat.txt`) so the text is still there but nothing runs.
 */
const BLOCKED_EXTS = new Set([
  "html", "htm", "xhtml", "shtml", "svg", "svgz", "hta", "js", "mjs", "cjs", "jse", "vbs", "vbe", "wsf", "wsh",
  "exe", "com", "bat", "cmd", "msi", "msp", "scr", "pif", "cpl", "dll", "jar", "lnk", "reg", "url", "appref-ms",
  "docm", "xlsm", "pptm", "xlam", "iso", "img",
]);

const MAX_NAME_LENGTH = 80;

function splitExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

/**
 * Clean a file name proposed by the model: no folders, no control or reserved characters, spaces as
 * hyphens, at most 80 characters, and an allowed extension. Falls back to `file.txt`.
 */
export function sanitizeFileName(raw: string): { name: string; ext: string; renamed: boolean } {
  let name = (raw ?? "").trim();
  // Keep only the last path segment, whichever slash was used.
  name = name.split(/[\\/]/).pop() ?? "";
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+/, "");

  let { base, ext } = splitExt(name);
  base = base.replace(/[.\s]+$/, "") || "file";
  let renamed = false;

  if (!ext || BLOCKED_EXTS.has(ext) || (!KIND_BY_EXT[ext] && !TEXT_EXTS.has(ext))) {
    renamed = Boolean(ext);
    base = ext ? `${base}.${ext}` : base;
    ext = "txt";
  }

  const room = MAX_NAME_LENGTH - ext.length - 1;
  if (base.length > room) base = base.slice(0, room).replace(/[.\-]+$/, "") || "file";
  return { name: `${base}.${ext}`, ext, renamed };
}

/** File type for an already-clean name. */
export function specForName(rawName: string): FileSpec {
  const { name, ext, renamed } = sanitizeFileName(rawName);
  const known = KIND_BY_EXT[ext];
  if (known) return { name, ext, kind: known.kind, mime: known.mime, renamed };
  const mime = ext === "json" ? "application/json" : ext === "xml" ? "application/xml" : "text/plain";
  return { name, ext, kind: "text", mime, renamed };
}

/**
 * Read the `file:<name>` info string of a fenced block. Returns null for ordinary code blocks.
 * Accepts `file:report.xlsx` and `file:"Q3 report.xlsx"`.
 */
export function parseFileInfo(info: string | null | undefined): FileSpec | null {
  const value = (info ?? "").trim();
  if (!value.toLowerCase().startsWith(FILE_INFO_PREFIX)) return null;
  const rest = value.slice(FILE_INFO_PREFIX.length).trim().replace(/^["']|["']$/g, "");
  if (!rest) return null;
  return specForName(rest);
}

const LANGUAGE_EXTS: Record<string, string> = {
  bash: "sh", shell: "sh", sh: "sh", zsh: "zsh", powershell: "ps1", ps1: "ps1", pwsh: "ps1",
  python: "py", py: "py", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", javascript: "js", js: "js",
  json: "json", jsonc: "json", yaml: "yaml", yml: "yaml", xml: "xml", sql: "sql", toml: "toml", ini: "ini",
  hcl: "tf", terraform: "tf", tf: "tf", dockerfile: "dockerfile", go: "go", golang: "go", rust: "rs", rs: "rs",
  ruby: "rb", rb: "rb", php: "php", java: "java", kotlin: "kt", csharp: "cs", cs: "cs", c: "c", cpp: "cpp",
  swift: "swift", css: "css", scss: "scss", diff: "diff", markdown: "md", md: "md", csv: "csv", tsv: "tsv",
  log: "log", text: "txt", txt: "txt", plaintext: "txt", graphql: "graphql", html: "html",
};

/** A download name for an ordinary code block, from its language label. Unsafe types become .txt. */
export function fileNameForCodeLanguage(language: string): string {
  const ext = LANGUAGE_EXTS[language.trim().toLowerCase()] ?? "txt";
  return sanitizeFileName(`snippet.${ext}`).name;
}

/** Bytes of a UTF-8 string, without building a Blob. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
