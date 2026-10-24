/**
 * Markdown → Word (.docx), built in the browser.
 *
 * The reply's Markdown is parsed into a syntax tree (the same GFM rules the chat uses to display it)
 * and each node becomes a Word paragraph, list item, table or code block. Images are left out and
 * links keep their text with the address, so the document never fetches anything when opened.
 */

import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable,
} from "mdast";

type Docx = typeof import("docx");
type DocxChild = import("docx").Paragraph | import("docx").Table;
type Inline = import("docx").ParagraphChild;

type RunStyle = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };

const CODE_FONT = "Consolas";
const SAFE_LINK = /^(https?:|mailto:)/i;
const HEADINGS = ["HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"] as const;

async function parseMarkdown(markdown: string): Promise<Root> {
  const [{ fromMarkdown }, { gfm }, { gfmFromMarkdown }] = await Promise.all([
    import("mdast-util-from-markdown"),
    import("micromark-extension-gfm"),
    import("mdast-util-gfm"),
  ]);
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

function plainText(node: PhrasingContent | RootContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return (node.children as Array<PhrasingContent | RootContent>).map(plainText).join("");
  }
  return "";
}

export async function buildDocx(markdown: string, title?: string): Promise<Uint8Array<ArrayBuffer>> {
  const d: Docx = await import("docx");
  const tree = await parseMarkdown(markdown);
  let numberedLists = 0;

  const run = (text: string, style: RunStyle = {}) =>
    new d.TextRun({
      text,
      bold: style.bold,
      italics: style.italics,
      strike: style.strike,
      ...(style.code ? { font: CODE_FONT, shading: { type: d.ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } } : {}),
    });

  function inlines(nodes: PhrasingContent[], style: RunStyle = {}): Inline[] {
    const out: Inline[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          out.push(run(node.value, style));
          break;
        case "strong":
          out.push(...inlines(node.children, { ...style, bold: true }));
          break;
        case "emphasis":
          out.push(...inlines(node.children, { ...style, italics: true }));
          break;
        case "delete":
          out.push(...inlines(node.children, { ...style, strike: true }));
          break;
        case "inlineCode":
          out.push(run(node.value, { ...style, code: true }));
          break;
        case "break":
          out.push(new d.TextRun({ text: "", break: 1 }));
          break;
        case "link": {
          const label = node.children.map(plainText).join("") || node.url;
          if (SAFE_LINK.test(node.url)) {
            out.push(
              new d.ExternalHyperlink({
                link: node.url,
                children: [new d.TextRun({ text: label, style: "Hyperlink" })],
              }),
            );
          } else {
            out.push(run(label, style));
          }
          break;
        }
        case "image":
          if (node.alt) out.push(run(`[image: ${node.alt}]`, { ...style, italics: true }));
          break;
        default:
          out.push(run(plainText(node), style));
      }
    }
    return out;
  }

  function codeBlock(value: string): DocxChild[] {
    const lines = value.replace(/\n$/, "").split("\n");
    return lines.map(
      (line, i) =>
        new d.Paragraph({
          children: [new d.TextRun({ text: line || " ", font: CODE_FONT, size: 20 })],
          shading: { type: d.ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
          spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 120 : 0 },
        }),
    );
  }

  function table(node: MdTable): DocxChild {
    return new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      rows: node.children.map(
        (row, ri) =>
          new d.TableRow({
            tableHeader: ri === 0,
            children: row.children.map(
              cell =>
                new d.TableCell({
                  children: [new d.Paragraph({ children: inlines(cell.children, { bold: ri === 0 }) })],
                  ...(ri === 0 ? { shading: { type: d.ShadingType.CLEAR, fill: "EDEDED", color: "auto" } } : {}),
                }),
            ),
          }),
      ),
    });
  }

  function list(node: List, level: number): DocxChild[] {
    const ordered = Boolean(node.ordered);
    const instance = ordered ? ++numberedLists : 0;
    const out: DocxChild[] = [];
    for (const item of node.children as ListItem[]) {
      let first = true;
      for (const child of item.children) {
        if (child.type === "paragraph") {
          const prefix = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
          const children = [...(prefix ? [run(prefix)] : []), ...inlines(child.children)];
          out.push(
            first
              ? new d.Paragraph({
                  children,
                  numbering: ordered
                    ? { reference: "numbers", level: Math.min(level, 4), instance }
                    : { reference: "bullets", level: Math.min(level, 4) },
                })
              : new d.Paragraph({ children, indent: { left: 720 * (level + 1) } }),
          );
          first = false;
        } else if (child.type === "list") {
          out.push(...list(child, level + 1));
        } else {
          out.push(...block(child));
        }
      }
    }
    return out;
  }

  function block(node: RootContent | BlockContent | DefinitionContent): DocxChild[] {
    switch (node.type) {
      case "heading":
        return [
          new d.Paragraph({
            heading: d.HeadingLevel[HEADINGS[Math.min(node.depth, 6) - 1]],
            children: inlines(node.children),
          }),
        ];
      case "paragraph":
        return [new d.Paragraph({ children: inlines(node.children), spacing: { after: 120 } })];
      case "list":
        return list(node, 0);
      case "code":
        return codeBlock(node.value);
      case "table":
        return [table(node), new d.Paragraph({ children: [] })];
      case "blockquote":
        return node.children.flatMap(child =>
          child.type === "paragraph"
            ? [
                new d.Paragraph({
                  children: inlines(child.children, { italics: true }),
                  indent: { left: 720 },
                  border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } },
                }),
              ]
            : block(child),
        );
      case "thematicBreak":
        return [
          new d.Paragraph({
            children: [],
            border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } },
          }),
        ];
      case "html":
        return node.value.trim() ? [new d.Paragraph({ children: [run(node.value)] })] : [];
      default:
        return [];
    }
  }

  const children = tree.children.flatMap(block);
  const bulletLevels = [0, 1, 2, 3, 4].map(level => ({
    level,
    format: d.LevelFormat.BULLET,
    text: ["•", "◦", "▪", "•", "◦"][level],
    alignment: d.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const numberLevels = [0, 1, 2, 3, 4].map(level => ({
    level,
    format: [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN][level % 3],
    text: `%${level + 1}.`,
    alignment: d.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

  const doc = new d.Document({
    creator: "SecureMind",
    title: title ?? "Document",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        { reference: "bullets", levels: bulletLevels },
        { reference: "numbers", levels: numberLevels },
      ],
    },
    sections: [{ children: children.length ? children : [new d.Paragraph({ children: [] })] }],
  });

  return new Uint8Array(await d.Packer.toArrayBuffer(doc)) as Uint8Array<ArrayBuffer>;
}
