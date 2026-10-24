/** Cell text of a rendered Markdown table (a hast `table` element), for the CSV and Excel buttons. */

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
};

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.tagName === "br") return "\n";
  return (node.children ?? []).map(textOf).join("");
}

function collectRows(node: HastNode, out: HastNode[]): void {
  if (node.tagName === "tr") {
    out.push(node);
    return;
  }
  for (const child of node.children ?? []) collectRows(child, out);
}

export function tableRowsFromHast(table: unknown): string[][] {
  if (!table || typeof table !== "object") return [];
  const rows: HastNode[] = [];
  collectRows(table as HastNode, rows);
  return rows.map(tr =>
    (tr.children ?? [])
      .filter(c => c.tagName === "th" || c.tagName === "td")
      .map(c => textOf(c).trim()),
  );
}

/** The info string of a fenced block as written (language plus the rest of the line). */
export function codeInfoFromHast(pre: unknown): string {
  const code = (pre as { children?: Array<{ tagName?: string; properties?: { className?: unknown }; data?: { meta?: unknown } }> })
    ?.children?.find(c => c.tagName === "code");
  if (!code) return "";
  const classes = Array.isArray(code.properties?.className) ? (code.properties.className as unknown[]) : [];
  const lang = classes.map(String).find(c => c.startsWith("language-"))?.slice("language-".length) ?? "";
  const meta = typeof code.data?.meta === "string" ? code.data.meta : "";
  return meta ? `${lang} ${meta}` : lang;
}
