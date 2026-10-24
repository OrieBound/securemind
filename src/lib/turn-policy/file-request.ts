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
  /** The previous reply was cut off inside the file: write the whole file again in one block. */
  rewrite?: boolean;
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
/**
 * Up to three describing words between the article and the file: "a formatted Word document",
 * "an actual Excel file", "a nicely formatted doc". Words that begin a phrase about something else
 * ("a summary of the CSV file") end the match, so an existing file is not mistaken for a new one.
 */
const DESCRIBERS =
  "(?:(?!(?:of|the|this|that|these|those|my|your|our|from|in|on|for|about|with|and|or|to|into|as)\\b)[a-z][\\w'-]*\\s+){0,3}";

/** "as an Excel file", "into a spreadsheet", "to CSV", "in Word format", "as a nicely formatted file". */
const AS_TARGET = new RegExp(
  `\\b(?:as|into|to|in)\\s+(?:an?\\s+|the\\s+)?${DESCRIBERS}(?:${FORMAT_WORD}(?:\\s+${FILE_NOUN}|\\s+format)?|${FILE_NOUN})\\b`,
  "i",
);
/** "a CSV file", "an Excel sheet", "a formatted Word document", "an actual Word document". */
const ARTICLE_TARGET = new RegExp(
  `\\b(?:an?|new|downloadable|separate)\\s+${DESCRIBERS}(?:${FORMAT_WORD}\\s+)?(?:${FILE_NOUN})\\b`,
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

function lastMatch(re: RegExp, text: string): string | undefined {
  const all = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
  return all.length ? all[all.length - 1][0] : undefined;
}

function formatIn(text: string): string | null {
  const named = FILE_NAME.exec(text);
  if (named) return named[1].toLowerCase() === "yml" ? "yaml" : named[1].toLowerCase();
  for (const [re, ext] of FORMATS) if (re.test(text)) return ext;
  return null;
}

export function detectFileRequest(message: string): FileRequest | null {
  const text = (message ?? "").trim();
  if (!text || !MAKE_VERB.test(text)) return null;

  // The request is usually the last file phrase: "you gave me a text file, could you make a Word document".
  const target =
    lastMatch(AS_TARGET, text) ??
    lastMatch(ARTICLE_TARGET, text) ??
    lastMatch(BARE_FORMAT_TARGET, text) ??
    lastMatch(FILE_NAME, text) ??
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

/** "Please continue…" (the Continue button) or a short "continue" / "keep going". */
const CONTINUE_REQUEST = /^(?:please\s+)?(?:continue|keep going|go on|carry on|finish)\b/i;

/** True when the text ends while a code fence is still open (the reply was cut off mid-block). */
function endsInsideFence(text: string): boolean {
  let open: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    if (!open) open = m[1][0];
    else if (m[1][0] === open && line.slice(m[0].length).trim() === "") open = null;
  }
  return open !== null;
}

/** How far back a file request is remembered while the assistant has not delivered it yet. */
const MAX_PENDING_USER_TURNS = 3;

/**
 * The file request for this turn. Besides a request in the message itself, it covers follow-ups:
 * - Continue after a reply that was cut off inside the file: the whole file is written again in one
 *   block, because two partial blocks cannot be joined into one download;
 * - a change ("add a column", "make it 10 rows") right after the assistant delivered a file;
 * - an answer or a retry ("five columns, five rows", "try again") while an earlier request in the last
 *   few turns has not been delivered yet, including after a reply that failed and so left no text.
 */
export function resolveFileRequest(
  message: string,
  history: ReadonlyArray<{ role: string; content: string }> = [],
): FileRequest | null {
  const direct = detectFileRequest(message);
  if (direct) return direct;
  const text = message.trim();

  const latest = history[history.length - 1];
  if (latest?.role === "assistant" && FILE_BLOCK.test(latest.content)) {
    const ext = extOfDelivered(latest.content);
    if (endsInsideFence(latest.content) && CONTINUE_REQUEST.test(text)) return { ext, rewrite: true };
    if (text.length > 300 || QUESTION.test(text) || !EDIT_REQUEST.test(text)) return null;
    return { ext };
  }

  let userTurns = 0;
  for (let i = history.length - 1; i >= 0 && userTurns < MAX_PENDING_USER_TURNS; i--) {
    const m = history[i];
    if (m.role === "assistant") {
      if (FILE_BLOCK.test(m.content)) return null; // that request was delivered
      continue;
    }
    if (m.role !== "user") continue;
    userTurns++;
    const earlier = detectFileRequest(m.content);
    if (earlier) return earlier;
  }
  return null;
}

/** Response instructions for a file turn. Appended to the system prompt for that turn only. */
export function fileOutputInstructions(request: FileRequest): string {
  const wanted = request.ext ? `- Make it a .${request.ext} file.\n` : "";
  const rewrite = request.rewrite
    ? `- Your previous reply was cut off inside the file. Do not continue it: write the complete file again from the beginning, in one block. Keep it shorter so it fits.\n`
    : "";
  return (
    `\n\nResponse mode — the user wants a downloadable file:\n` +
    `- The app builds the file in their browser from your reply. Never say you cannot create or send files.\n` +
    rewrite +
    `- You have no live or current data (sports scores, prices, news, weather). If the file needs it, say so in one sentence and fill the file with clearly labelled sample data or with what the user gave you. Never present invented data as real.\n` +
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
