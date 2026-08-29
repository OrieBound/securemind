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

function appPublicUrl(): string {
  const raw =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
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

/** Welcome notice when an Admin creates a Cognito directory user. */
export async function sendWelcomeAddedEmail(opts: {
  to: string;
  role: AppRole;
}): Promise<MailSendResult> {
  const signInUrl = `${appPublicUrl()}/`;
  const roleLabel =
    opts.role === "super_admin" ? "Super Admin" : opts.role === "admin" ? "Admin" : "Member";
  const subject = "You've been added to SecureMind";
  const text = [
    "Hello,",
    "",
    `An administrator has added you to SecureMind as a ${roleLabel}.`,
    "",
    `Sign in: ${signInUrl}`,
    "",
    "Your sign-in password was set by the administrator who created your account.",
    "If you do not have those credentials, contact them directly — this email does not include a password.",
    "",
    "— SecureMind",
  ].join("\n");

  const html = `
    <p>Hello,</p>
    <p>An administrator has added you to <strong>SecureMind</strong> as a <strong>${roleLabel}</strong>.</p>
    <p><a href="${signInUrl}">Sign in to SecureMind</a></p>
    <p>Your sign-in password was set by the administrator who created your account.
    If you do not have those credentials, contact them directly — this email does not include a password.</p>
    <p>— SecureMind</p>
  `.trim();

  return sendMail({ to: opts.to, subject, text, html });
}
