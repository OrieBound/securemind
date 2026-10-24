/**
 * Did the person ask for a downloadable file?
 *
 * A file request is about the *shape* of the reply, not its topic, so it never changes retrieval,
 * Sources or the complexity tier: "export the runbook steps as a Word document" still searches
 * Knowledge. It adds response instructions and a longer reply limit for that turn only.
 *
 * It fires on a request to make something ("export this as Excel", "give me a CSV file", "save it as
 * app.log"), not on a mention of a file that already exists ("summarize the CSV I uploaded",
 * "the log says", "file a bug").
 */

export type FileRequest = {
  /** The extension asked for, or null when the person only said "as a file". */
  ext: string | null;
};

const FORMATS: Array<[RegExp, string]> = [
  [/\b(?:excel|xlsx|spreadsheet|workbook)\b/i, "xlsx"],
  [/\bcsv\b/i, "csv"],
  [/\btsv\b/i, "tsv"],
  [/\b(?:word|docx|ms word)\b/i, "docx"],
  [/\b(?:markdown|\.md)\b/i, "md"],
  [/\bjson\b/i, "json"],
  [/\b(?:yaml|yml)\b/i, "yaml"],
  [/\bxml\b/i, "xml"],
  [/\blog\b/i, "log"],
  [/\b(?:text|txt|plain text)\b/i, "txt"],
];

const FORMAT_WORD =
  "(?:excel|xlsx|spreadsheet|workbook|csv|tsv|word|docx|markdown|md|json|yaml|yml|xml|log|text|txt|plain text)";
const FILE_NOUN = "(?:file|document|doc|sheet|spreadsheet|workbook|export|download|attachment)";

/** "as an Excel file", "into a spreadsheet", "to CSV", "in Word format", "as a file". */
const AS_TARGET = new RegExp(
  `\\b(?:as|into|to|in)\\s+(?:an?\\s+|the\\s+)?(?:new\\s+|separate\\s+|downloadable\\s+)?(?:${FORMAT_WORD}(?:\\s+${FILE_NOUN}|\\s+format)?|${FILE_NOUN})\\b`,
  "i",
);
/** "a CSV file", "an Excel sheet", "a Word document", "a downloadable file". */
const ARTICLE_TARGET = new RegExp(
  `\\b(?:an?|new|downloadable|separate)\\s+(?:${FORMAT_WORD}\\s+)?(?:${FILE_NOUN})\\b`,
  "i",
);
/** "a CSV", "an xlsx", "a .log" right after a making verb. */
const BARE_FORMAT_TARGET = new RegExp(`\\b(?:an?)\\s+\\.?${FORMAT_WORD}\\b`, "i");
/** "report.xlsx", "app.log". */
const FILE_NAME = /\b[\w-]+\.(xlsx|csv|tsv|docx|md|txt|log|json|ya?ml|xml)\b/i;

const MAKE_VERB =
  /\b(?:export|download|save|convert|turn|put|give|send|create|make|generate|produce|write|prepare|build|draft|output|provide)\b/i;

/** "the CSV I uploaded", "this spreadsheet", "my attached file": an existing file, not a new one. */
const EXISTING_FILE = new RegExp(
  `\\b(?:the|this|that|my|attached|uploaded|your)\\s+(?:attached\\s+|uploaded\\s+)?(?:${FORMAT_WORD}\\s+)?${FILE_NOUN}\\b`,
  "i",
);

function formatIn(text: string): string | null {
  const named = FILE_NAME.exec(text);
  if (named) return named[1].toLowerCase() === "yml" ? "yaml" : named[1].toLowerCase();
  for (const [re, ext] of FORMATS) if (re.test(text)) return ext;
  return null;
}

export function detectFileRequest(message: string): FileRequest | null {
  const text = (message ?? "").trim();
  if (!text || !MAKE_VERB.test(text)) return null;

  const target =
    AS_TARGET.exec(text)?.[0] ??
    ARTICLE_TARGET.exec(text)?.[0] ??
    BARE_FORMAT_TARGET.exec(text)?.[0] ??
    FILE_NAME.exec(text)?.[0] ??
    null;
  if (!target) return null;

  // "give me a summary of the CSV file I uploaded" names an existing file, and nothing new is asked for.
  const existing = EXISTING_FILE.exec(text)?.[0];
  if (existing && existing === target) return null;
  if (existing && !AS_TARGET.test(text) && !ARTICLE_TARGET.test(text) && !FILE_NAME.test(text)) return null;

  return { ext: formatIn(target) ?? formatIn(text.slice(text.indexOf(target))) };
}

const FILE_BLOCK = /```\s*file:\s*"?([^\s"`]+)/i;

/** "add a column", "make it 10 rows", "five columns, five rows", "sort by date instead". */
const EDIT_REQUEST =
  /\b(?:add|remove|delete|drop|change|update|edit|rename|replace|sort|reorder|swap|instead|more|fewer|less|another|extra|include|exclude|redo|regenerate|fix|shorten|lengthen|expand|make it|columns?|rows?|sheets?|sections?|headings?)\b/i;
/** A question about the file ("what does row 3 mean?") is answered, not turned into a new file. */
const QUESTION = /^(?:what|why|how|which|who|when|where|explain|can you explain|does|is|are)\b|\?\s*$/i;

function extOfDelivered(content: string): string | null {
  const name = FILE_BLOCK.exec(content)?.[1];
  const ext = name?.split(".").pop()?.toLowerCase();
  return ext && ext !== name?.toLowerCase() ? ext : null;
}

/**
 * The file request for this turn, including two follow-ups to the previous exchange:
 * - an answer ("five columns, five rows") after the assistant asked a question instead of making the file;
 * - a change ("add a column", "make it 10 rows") right after the assistant delivered a file.
 * One step back only.
 */
export function resolveFileRequest(
  message: string,
  history: ReadonlyArray<{ role: string; content: string }> = [],
): FileRequest | null {
  const direct = detectFileRequest(message);
  if (direct) return direct;

  let lastUser = -1;
  let lastAssistant = -1;
  for (let i = history.length - 1; i >= 0 && (lastUser < 0 || lastAssistant < 0); i--) {
    if (history[i].role === "user" && lastUser < 0) lastUser = i;
    if (history[i].role === "assistant" && lastAssistant < 0) lastAssistant = i;
  }
  if (lastUser < 0 || lastAssistant < lastUser) return null;

  const reply = history[lastAssistant].content;
  if (FILE_BLOCK.test(reply)) {
    const text = message.trim();
    if (text.length > 300 || QUESTION.test(text) || !EDIT_REQUEST.test(text)) return null;
    return { ext: extOfDelivered(reply) };
  }
  return detectFileRequest(history[lastUser].content);
}

/** Response instructions for a file turn. Appended to the system prompt for that turn only. */
export function fileOutputInstructions(request: FileRequest): string {
  const wanted = request.ext ? `- Make it a .${request.ext} file.\n` : "";
  return (
    `\n\nResponse mode — the user wants a downloadable file:\n` +
    `- The app builds the file in their browser from your reply. Never say you cannot create or send files.\n` +
    `- Make the file in this reply. If details are missing (columns, rows, length, format), choose sensible defaults and say in one sentence what you assumed. Do not ask a question first.\n` +
    `- Start with one short sentence saying you are preparing the file.\n` +
    `- Then put the whole file in exactly one fenced code block whose info string is file:<name.ext>, ` +
    `for example \`\`\`file:inventory.xlsx. Use a short descriptive name with hyphens instead of spaces.\n` +
    wanted +
    `- Excel (.xlsx) and CSV (.csv): write the data as CSV with a header row; quote any field that contains a comma. ` +
    `For several sheets in one .xlsx, start each sheet with a line --- sheet: Name ---.\n` +
    `- Word (.docx) and Markdown (.md): write Markdown with headings, numbered steps, bullet lists and tables.\n` +
    `- Text, log, JSON, YAML and similar: write the exact file contents.\n` +
    `- Never put the file in an ordinary code block or ask the user to copy it; only the file: block becomes a download.\n` +
    `- No HTML, no scripts, no spreadsheet formulas. Keep redacted placeholders such as [email redacted] exactly as written; never guess the original value.\n` +
    `- After the block, add at most one short sentence.`
  );
}
