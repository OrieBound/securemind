import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dark theme is the design default, so many components use pale Tailwind shades
 * (`text-emerald-200/80`, `bg-amber-400/10`). On a light surface those wash out, so
 * `globals.css` remaps each one to a theme-aware token under `html:not(.dark)`.
 * A shade the app uses but the stylesheet does not list stays pale in light mode.
 */

const HUES = "emerald|green|teal|lime|red|rose|amber|yellow|orange|sky|blue|cyan|violet|purple|fuchsia|indigo";
const CLASS = new RegExp(
  String.raw`(?<![\w/-])((?:[a-z-]+:)*)(text|bg|border|ring)-(${HUES})-(\d{2,3})(?:/(\d+|\[[0-9.]+\]))?(?![\w-])`,
  "g",
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

function escapeForCss(cls: string): string {
  return cls.replace(/[:/\[\].]/g, ch => "\\" + ch);
}

describe("light theme colour coverage", () => {
  it("remaps every pale tint the app uses", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const lightCss = css.slice(css.indexOf("Light-mode contrast remaps"));
    const missing = new Set<string>();

    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CLASS)) {
        const [full, variants, kind, , shadeStr, alpha] = m;
        if (variants.includes("dark:") || Number(shadeStr) > 500) continue;
        if (kind === "bg") {
          // Solid and strong fills (status dots, bars, buttons) are meant to stay saturated.
          const pct = alpha === undefined ? 100 : alpha.startsWith("[") ? Number(alpha.slice(1, -1)) * 100 : Number(alpha);
          if (pct >= 50) continue;
        }
        if (!lightCss.includes("." + escapeForCss(full))) missing.add(full);
      }
    }

    expect([...missing].sort()).toEqual([]);
  });
});
