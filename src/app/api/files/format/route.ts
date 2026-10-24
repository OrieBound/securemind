export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { hitRateLimit } from "@/lib/rate-limit";
import { NON_EXEMPTIBLE_CATEGORIES, scrubPII } from "@/lib/pii";
import { runFileFormatter } from "@/lib/models/task-models";

const MAX_CHARS = 40_000;
const EXTS = /^[a-z0-9]{1,8}$/;

/**
 * Turn a finished reply into a file block with the Admin's approved file helper.
 *
 * Only called by the browser after the ordinary fallback found nothing to convert. The text is the
 * assistant reply already on screen; it is re-checked for the categories that can never be
 * safe-listed before any model sees it. Nothing is stored. With no helper set it returns 404 so the
 * browser simply keeps the reply as it is.
 */
export async function POST(req: NextRequest) {
  try {
    const identity = await getIdentity(req);

    const wait = hitRateLimit("file-format", identity.userId, 20, 60_000);
    if (wait) {
      return Response.json({ error: "Too many file requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(wait) } });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) return Response.json({ error: "Nothing to format." }, { status: 422 });
    if (text.length > MAX_CHARS) return Response.json({ error: "That reply is too long to turn into a file." }, { status: 413 });
    const ext = typeof body.ext === "string" && EXTS.test(body.ext) ? body.ext : null;

    const scrubbed = scrubPII(text, { sensitivity: "high", onlyCategories: NON_EXEMPTIBLE_CATEGORIES });
    const result = await runFileFormatter({ text: scrubbed.hadRedactions ? scrubbed.sanitized : text, ext });
    if (result.ok) {
      return Response.json({ content: result.content }, { headers: { "Cache-Control": "no-store" } });
    }
    if (result.reason === "not_configured") return Response.json({ error: result.message }, { status: 404 });
    return Response.json({ error: result.message, reason: result.reason }, { status: 422 });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
