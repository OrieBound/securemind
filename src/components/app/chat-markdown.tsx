"use client";

import { Check, Copy } from "lucide-react";
import {
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeDownloadButton, FileCard, TableDownloads, type FileCardState } from "@/components/app/file-card";
import { endsInsideCodeFence } from "@/lib/chat/truncation";
import { parseFileInfo } from "@/lib/files/file-spec";
import { codeInfoFromHast, tableRowsFromHast } from "@/lib/files/hast-table";

/** Plain text of a React node tree (what the user would copy from a code block). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for plain-http installs.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const child = Array.isArray(children) ? children[0] : children;
  const codeProps = isValidElement(child)
    ? ((child as ReactElement).props as { className?: string; children?: ReactNode })
    : undefined;
  const language = /language-([\w+#.-]+)/.exec(codeProps?.className ?? "")?.[1] ?? "";
  const code = textOf(codeProps?.children ?? children).replace(/\n$/, "");

  async function onCopy() {
    if (!(await copyText(code))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{language || "code"}</span>
        <span className="flex items-center gap-1">
        <CodeDownloadButton language={language} code={code} />
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={copied ? "Code copied" : "Copy code"}
          className="code-block-copy"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/**
 * Split markdown into top-level blocks so a streaming reply only re-parses the block
 * that is still growing. A boundary is a blank line outside a code fence that is followed
 * by an unindented line which is not a list item, so lists and indented continuations
 * stay together.
 */
export function splitMarkdownBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: { char: string; length: number } | null = null;
  const nextContent = (from: number) => {
    for (let j = from; j < lines.length; j++) if (lines[j].trim() !== "") return lines[j];
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = { char: f[1][0], length: f[1].length };
      else if (f[1][0] === fence.char && f[1].length >= fence.length && line.slice(f[0].length).trim() === "") fence = null;
    }
    current.push(line);
    if (!fence && line.trim() === "") {
      const next = nextContent(i + 1);
      if (next !== null && /^\S/.test(next) && !/^([-*+]|\d+[.)])\s/.test(next)) {
        blocks.push(current.join("\n"));
        current = [];
      }
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

const MarkdownBlock = memo(function MarkdownBlock({
  text,
  components,
}: {
  text: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});

function buildComponents(
  onLinkClick: ((href: string | undefined) => void) | undefined,
  fileState: FileCardState,
): Components {
  return {
    a: ({ href, children }) => {
      const internal = Boolean(href?.startsWith("/") && !href.startsWith("//"));
      return (
        <a
          href={href}
          onClick={() => onLinkClick?.(href)}
          {...(!internal ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        >
          {children}
        </a>
      );
    },
    pre: ({ node, children }) => {
      // A fenced block with the info string file:<name> is a file the assistant wrote for download.
      const spec = parseFileInfo(codeInfoFromHast(node));
      if (spec) return <FileCard spec={spec} body={textOf(children).replace(/\n$/, "")} state={fileState} />;
      return <CodeBlock>{children}</CodeBlock>;
    },
    table: ({ node, children }) => (
      <>
        <TableDownloads rows={tableRowsFromHast(node)} />
        <table>{children}</table>
      </>
    ),
  };
}

/**
 * Chat message markdown: code blocks (language label, Copy, Download), tables with CSV and Excel
 * buttons, file cards for `file:` blocks, and cheap streaming updates.
 */
export function ChatMarkdown({
  content,
  onLinkClick,
  streaming = false,
  truncated = false,
}: {
  content: string;
  /** Called with the href of any link the reader clicks (used for the Bedrock highlight link). */
  onLinkClick?: (href: string | undefined) => void;
  /** The reply is still arriving: a file block that is still open shows "Preparing file…". */
  streaming?: boolean;
  /** The reply hit its length limit: a file block left open is marked incomplete. */
  truncated?: boolean;
}) {
  const components = useMemo(() => buildComponents(onLinkClick, "ready"), [onLinkClick]);
  const openFence = useMemo(() => endsInsideCodeFence(content), [content]);
  const lastState: FileCardState = openFence ? (streaming ? "preparing" : truncated ? "incomplete" : "ready") : "ready";
  const lastComponents = useMemo(() => buildComponents(onLinkClick, lastState), [onLinkClick, lastState]);
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  return (
    <>
      {blocks.map((block, i) => (
        <MarkdownBlock
          key={i}
          text={block}
          components={i === blocks.length - 1 ? lastComponents : components}
        />
      ))}
    </>
  );
}
