/**
 * Chart/table export helpers. Never include raw PII or prompt bodies.
 */

export type ExportMeta = {
  title: string;
  rangeLabel: string;
  workspaceLabel: string;
  generatedAt?: string;
  disclaimer?: string;
};

function stamp(meta: ExportMeta): string {
  return meta.generatedAt ?? new Date().toISOString();
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function rowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
}

export function markdownSummary(
  meta: ExportMeta,
  lines: string[],
): string {
  return [
    `# ${meta.title}`,
    "",
    `- Product: SecureMind`,
    `- Date range: ${meta.rangeLabel}`,
    `- Workspace: ${meta.workspaceLabel}`,
    `- Generated: ${stamp(meta)}`,
    meta.disclaimer ? `- Note: ${meta.disclaimer}` : null,
    "",
    ...lines.map(l => `- ${l}`),
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function downloadSvgElement(
  svg: SVGElement,
  meta: ExportMeta,
  filename: string,
) {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = `${meta.title} — SecureMind`;
  clone.insertBefore(title, clone.firstChild);
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(clone);
  downloadText(filename, source, "image/svg+xml;charset=utf-8");
}

export async function downloadPngFromSvg(
  svg: SVGElement,
  meta: ExportMeta,
  filename: string,
): Promise<void> {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(clone);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  const rect = svg.getBoundingClientRect();
  const width = Math.max(rect.width, 640);
  const height = Math.max(rect.height, 360);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to rasterize chart"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * 2);
  canvas.height = Math.round(height * 2 + 48);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error("Canvas unavailable");
  }
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "24px system-ui, sans-serif";
  ctx.fillText(`SecureMind · ${meta.title}`, 24, 36);
  ctx.drawImage(img, 0, 48, canvas.width, canvas.height - 48);
  URL.revokeObjectURL(url);

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob(blobOut => {
      if (!blobOut) {
        reject(new Error("PNG encode failed"));
        return;
      }
      const pngUrl = URL.createObjectURL(blobOut);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(pngUrl);
      resolve();
    }, "image/png");
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
