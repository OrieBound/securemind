import { describe, expect, it } from "vitest";
import { endsInsideCodeFence, CONTINUE_PROMPT } from "./truncation";
import { parseOpenAiSseStream } from "@/lib/models/vendor-stream";
import { splitMarkdownBlocks } from "@/components/app/chat-markdown";

describe("endsInsideCodeFence", () => {
  it("is true when a fence is still open", () => {
    expect(endsInsideCodeFence("Here you go:\n\n```ts\nconst a = 1;\nfunction f() {")).toBe(true);
  });
  it("is false once the fence closes", () => {
    expect(endsInsideCodeFence("```ts\nconst a = 1;\n```\n\nDone.")).toBe(false);
  });
  it("handles several blocks and ~~~ fences", () => {
    expect(endsInsideCodeFence("```js\na\n```\ntext\n~~~py\nprint(1)")).toBe(true);
    expect(endsInsideCodeFence("```js\na\n```\ntext\n~~~py\nprint(1)\n~~~")).toBe(false);
  });
  it("does not treat a shorter or different fence as the close", () => {
    expect(endsInsideCodeFence("````md\n```\ninner\n```\n")).toBe(true);
    expect(endsInsideCodeFence("```js\nx\n~~~")).toBe(true);
  });
  it("ignores inline triple backticks and plain text", () => {
    expect(endsInsideCodeFence("use ```inline``` like this")).toBe(false);
    expect(endsInsideCodeFence("just a normal reply")).toBe(false);
  });
});

describe("Continue prompt", () => {
  it("tells the model not to repeat and to reopen a code block", () => {
    expect(CONTINUE_PROMPT).toMatch(/Don't repeat/);
    expect(CONTINUE_PROMPT).toMatch(/code block/);
  });
});

function sseBody(frames: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

describe("OpenAI-format finish reason", () => {
  it("reports truncated when the model stopped at its length limit", async () => {
    let seen: boolean | null = null;
    const out: string[] = [];
    for await (const d of parseOpenAiSseStream(
      sseBody([
        { choices: [{ delta: { content: "hello " } }] },
        { choices: [{ delta: { content: "world" }, finish_reason: "length" }] },
      ]),
      undefined,
      info => { seen = info.truncated; },
    )) out.push(d);
    expect(out.join("")).toBe("hello world");
    expect(seen).toBe(true);
  });

  it("reports not truncated for a normal stop", async () => {
    let seen: boolean | null = null;
    for await (const d of parseOpenAiSseStream(
      sseBody([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
      undefined,
      info => { seen = info.truncated; },
    )) void d;
    expect(seen).toBe(false);
  });
});

describe("splitMarkdownBlocks", () => {
  it("round-trips the text", () => {
    const text = "# Title\n\nParagraph one.\n\n- a\n- b\n\nParagraph two.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nEnd.";
    expect(splitMarkdownBlocks(text).join("\n")).toBe(text);
  });
  it("never splits inside a code fence, even across blank lines", () => {
    const blocks = splitMarkdownBlocks("Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro");
    expect(blocks.some(b => b.includes("const a = 1;") && b.includes("const b = 2;"))).toBe(true);
  });
  it("keeps a loose list together", () => {
    const blocks = splitMarkdownBlocks("1. one\n\n2. two\n\n3. three\n\nAfter the list.");
    expect(blocks[0]).toContain("3. three");
    expect(blocks[1]).toContain("After the list.");
  });
  it("keeps an indented continuation with its list item", () => {
    const blocks = splitMarkdownBlocks("- item\n\n  more of item\n\nNext paragraph.");
    expect(blocks[0]).toContain("more of item");
  });
});

describe("ChatMarkdown code blocks", () => {
  it("renders a code block with its language and a Copy button", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ChatMarkdown } = await import("@/components/app/chat-markdown");
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, { content: "Try this:\n\n```python\nprint('hi')\n```\n\nThen run it." }),
    );
    expect(html).toContain('class="code-block"');
    expect(html).toContain(">python<");
    expect(html).toContain("Copy");
    expect(html).toContain("print(&#x27;hi&#x27;)");
    expect(html).toContain("Then run it.");
  });
});
