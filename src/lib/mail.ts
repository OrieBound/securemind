/**
 * Outbound email for Admin-triggered notices (welcome on invite, etc.).
 * Uses SMTP from env — never Cognito’s suppressed invite path.
 * Never put passwords or secrets in message bodies.
 */

import nodemailer from "nodemailer";
import type { AppRole } from "@/lib/roles";

export type MailSendResult =
  | { sent: true; to: string }
  | { sent: false; reason: "not_configured" | "send_failed"; detail?: string };

function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.MAIL_FROM?.trim(),
  );
}

export function isMailConfigured(): boolean {
  return smtpConfigured();
}

/** The address the person used to reach this app, as the proxy reports it. */
function requestOrigin(req: Request): string | null {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))?.split(",")[0]?.trim();
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : /^localhost(:|$)/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * The public address of this install. APP_PUBLIC_URL wins when set. Otherwise the address the signed-in
 * admin is using right now, so a cloud install never tells people to go to localhost.
 */
export function appPublicUrl(req?: Request): string {
  const raw =
    process.env.APP_PUBLIC_URL?.trim() ||
    (req ? requestOrigin(req) : null) ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export function appSignInUrl(req?: Request): string {
  return `${appPublicUrl(req)}/`;
}

function transport() {
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const secure =
    process.env.SMTP_SECURE === "true" || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<MailSendResult> {
  if (!smtpConfigured()) {
    return { sent: false, reason: "not_configured" };
  }
  try {
    await transport().sendMail({
      from: process.env.MAIL_FROM!.trim(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { sent: true, to: opts.to };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[mail] send failed:", detail.slice(0, 200));
    return { sent: false, reason: "send_failed", detail: detail.slice(0, 200) };
  }
}

function roleLabel(role: AppRole): string {
  return role === "super_admin" ? "Super Admin" : role === "admin" ? "Admin" : "Member";
}

/**
 * Invite notice when an Admin creates a directory user.
 * This is not a one-click magic link — it points at the public sign-in page.
 * Never include the password.
 */
export async function sendWelcomeAddedEmail(opts: {
  to: string;
  role: AppRole;
  /** Sign-in page to put in the message. Defaults to the configured address. */
  signInUrl?: string;
}): Promise<MailSendResult> {
  const signInUrl = opts.signInUrl ?? appSignInUrl();
  const label = roleLabel(opts.role);
  const subject = "You're invited to SecureMind";
  const text = [
    "Hello,",
    "",
    `An administrator has invited you to SecureMind as a ${label}.`,
    "",
    "This is not a one-click login link. Open the sign-in page and use the email this message was sent to.",
    `Sign-in page: ${signInUrl}`,
    "",
    "Your administrator set a password for this account and will share it separately.",
    "This email never includes a password. If you do not have it, contact the person who invited you.",
    "",
    "— SecureMind",
  ].join("\n");

  const html = `
    <p>Hello,</p>
    <p>An administrator has invited you to <strong>SecureMind</strong> as a <strong>${label}</strong>.</p>
    <p>This is not a one-click login link. Open the sign-in page and use the email this message was sent to.</p>
    <p>Sign-in page: <a href="${signInUrl}">${signInUrl}</a></p>
    <p>Your administrator set a password for this account and will share it separately.
    This email never includes a password. If you do not have it, contact the person who invited you.</p>
    <p>— SecureMind</p>
  `.trim();

  return sendMail({ to: opts.to, subject, text, html });
}

/** Notice after an admin sets a new password. Never includes the password. */
export async function sendAdminPasswordSetEmail(opts: {
  to: string;
}): Promise<MailSendResult> {
  const signInUrl = appSignInUrl();
  const subject = "Your SecureMind password was updated";
  const text = [
    "Hello,",
    "",
    "An administrator set a new sign-in password for your SecureMind account.",
    "They will share that password with you separately — this email does not include it.",
    "",
    `Sign-in page: ${signInUrl}`,
    "",
    "— SecureMind",
  ].join("\n");
  const html = `
    <p>Hello,</p>
    <p>An administrator set a new sign-in password for your SecureMind account.
    They will share that password with you separately — this email does not include it.</p>
    <p>Sign-in page: <a href="${signInUrl}">${signInUrl}</a></p>
    <p>— SecureMind</p>
  `.trim();
  return sendMail({ to: opts.to, subject, text, html });
}
