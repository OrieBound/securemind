/**
 * Helpers for `npm run bedrock:profile`: share ONE AWS CLI profile with the Docker app.
 * Pure functions, so they can be tested without touching anyone's AWS files.
 */
import { createHash } from "node:crypto";

/** Split an AWS config file into [{ header, lines }]. Comments and blank lines stay with their section. */
export function parseSections(text) {
  const sections = [];
  let current = { header: null, lines: [] };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) {
      if (current.header !== null || current.lines.some(l => l.trim())) sections.push(current);
      current = { header: m[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.header !== null || current.lines.some(l => l.trim())) sections.push(current);
  return sections;
}

function settingsOf(section) {
  const out = {};
  for (const line of section.lines) {
    const m = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function profileHeader(name) {
  return name === "default" ? "default" : `profile ${name}`;
}

/**
 * Pick the named profile and the sso-session it points at. Returns the text to write and what the
 * profile needs from the SSO cache. Profiles that hold access keys are refused on purpose: this tool
 * never copies secret keys.
 */
export function extractProfile(configText, name) {
  const sections = parseSections(configText);
  const profile = sections.find(s => s.header === profileHeader(name));
  if (!profile) return { ok: false, reason: `No profile named "${name}" in your AWS config.` };
  const settings = settingsOf(profile);
  if (!settings.sso_session && !settings.sso_start_url) {
    return {
      ok: false,
      reason: `Profile "${name}" does not use AWS single sign-on, so there is no sign-in to share. This tool never copies access keys.`,
    };
  }
  const keep = [profile];
  let cacheKey;
  if (settings.sso_session) {
    const session = sections.find(s => s.header === `sso-session ${settings.sso_session}`);
    if (!session) return { ok: false, reason: `Profile "${name}" names the sso-session "${settings.sso_session}", which is not in your AWS config.` };
    keep.push(session);
    cacheKey = settings.sso_session;
  } else {
    cacheKey = settings.sso_start_url;
  }
  const text =
    keep
      .map(s => `[${s.header}]\n${s.lines.filter(l => l.trim()).join("\n")}`)
      .join("\n\n") + "\n";
  return { ok: true, text, cacheFile: ssoCacheFileName(cacheKey) };
}

/** The AWS CLI stores the sign-in token under the SHA-1 of the sso-session name (or the start URL on older profiles). */
export function ssoCacheFileName(key) {
  return `${createHash("sha1").update(key).digest("hex")}.json`;
}
