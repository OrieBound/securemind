"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GETTING_STARTED_PATH, PROVIDERS_DEEP_LINK, markBedrockHighlight } from "@/lib/onboarding";
import { PRODUCT_NAME } from "@/lib/branding";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ScreenshotFrame({
  title,
  children,
  caption,
}: {
  title: string;
  children: ReactNode;
  caption?: string;
}) {
  return (
    <figure className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-foreground/12 bg-[#1a1b1f] shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-2 border-b border-white/8 bg-black/40 px-3 py-2">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 truncate text-[0.62rem] text-white/45">{title}</span>
        </div>
        <div className="p-4">{children}</div>
      </div>
      {caption ? (
        <figcaption className="text-meta text-center">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-semibold text-white">
          {n}
        </span>
        <h2 className="text-section">{title}</h2>
      </div>
      <div className="space-y-3 pl-11">{children}</div>
    </section>
  );
}

export function GettingStartedGuide({ edition: editionProp }: { edition: "local" | "cloud" }) {
  const [edition, setEdition] = useState(editionProp);
  useEffect(() => {
    void fetch("/api/setup/status", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { edition?: string } | null) => {
        if (d?.edition === "cloud" || d?.edition === "local") setEdition(d.edition);
      })
      .catch(() => {});
  }, []);
  const cloud = edition === "cloud";

  return (
    <div className="min-h-dvh bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-10">
        <header className="space-y-3">
          <p className="text-meta uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)]">
            {PRODUCT_NAME}
          </p>
          <h1 className="text-display">Get chat working</h1>
          <p className="text-body text-[var(--text-muted)] leading-[var(--leading-body)]">
            {cloud
              ? "This hosted workspace has no chat model until you connect one. Amazon Bedrock is the first choice here. Follow the clicks below — then send a message in Mindy Locke."
              : "This install has no chat model until you connect one. Start with Ollama on this machine, or Amazon Bedrock / a vendor key."}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href={PROVIDERS_DEEP_LINK}
              onClick={() => markBedrockHighlight()}
              className={cn(buttonVariants({ variant: "default" }), "h-10 px-4")}
            >
              Open Providers and highlight Bedrock
            </Link>
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
            >
              Back to chat
            </Link>
          </div>
        </header>

        {cloud ? (
          <>
            <Step n={1} title="Open Settings → Providers">
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                Bottom of the left sidebar: <strong className="text-foreground">Settings</strong>, then{" "}
                <strong className="text-foreground">Providers</strong>. Or use the button above — it opens that page and highlights the box you must check.
              </p>
              <ScreenshotFrame title="SecureMind · Settings" caption="Look for Providers in Settings — not Models.">
                <div className="flex gap-3 text-[0.72rem]">
                  <div className="w-28 shrink-0 space-y-1 rounded-lg bg-black/30 p-2 text-white/50">
                    {["Overview", "Models", "Providers", "My Profile"].map(label => (
                      <div
                        key={label}
                        className={cn(
                          "rounded-md px-2 py-1.5",
                          label === "Providers"
                            ? "bg-indigo-500/30 font-semibold text-indigo-100 ring-2 ring-indigo-400"
                            : "",
                        )}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-white/70">
                    <p className="text-[0.65rem] uppercase tracking-wider text-white/35">Providers</p>
                    <p className="mt-1 font-medium text-white/90">How models are reached</p>
                    <p className="mt-2 text-[0.68rem] leading-relaxed">
                      Vendor keys, Amazon Bedrock, and (on a local install) Ollama.
                    </p>
                  </div>
                </div>
              </ScreenshotFrame>
            </Step>

            <Step n={2} title="Check the Bedrock billing acknowledgement">
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                This is the click that turns Bedrock on for this app. It is a checkbox, not a pasted AWS key.
                SecureMind never asks for an AWS access key.
              </p>
              <ScreenshotFrame
                title="Settings → Providers → Amazon Bedrock"
                caption="Check this box. It will turn green when it is on."
              >
                <div className="relative space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white/90">Amazon Bedrock</p>
                    <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase text-amber-300">
                      Not ready
                    </span>
                  </div>
                  <p className="text-[0.72rem] text-white/55">
                    Enable Amazon Bedrock. SecureMind cannot enable model access or set AWS billing limits for you.
                  </p>
                  <div
                    className={cn(
                      "relative flex items-start gap-3 rounded-lg border px-3 py-3 text-[0.78rem]",
                      "border-amber-400 bg-amber-500/15 ring-4 ring-indigo-400/80",
                    )}
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2 border-white/80 bg-transparent" />
                    <span className="leading-snug text-white/90">
                      I understand that enabling Bedrock permits SecureMind to make billable model requests in
                      my AWS account.
                    </span>
                    <span className="absolute -right-1 -top-8 rotate-[-8deg] rounded-full bg-indigo-500 px-2.5 py-1 text-[0.65rem] font-semibold text-white shadow-lg">
                      Click this
                    </span>
                  </div>
                </div>
              </ScreenshotFrame>
            </Step>

            <Step n={3} title="Allow models in the AWS console">
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                In the same AWS account as this install, open Bedrock
                and enable the models you want to use (at least one text chat model). Then check
                the billing box in Settings → Providers.
              </p>
              <p className="text-ui">
                <a
                  href="https://console.aws.amazon.com/bedrock/home#/modelaccess"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-indigo-300 underline underline-offset-2"
                >
                  Open Bedrock model access
                </a>
                {" "}(AWS console, new tab).
              </p>
            </Step>

            <Step n={4} title="Come back and send a message">
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                Return to chat with Mindy Locke. The Insights rail should stop saying the model is not set up.
                Then Knowledge uploads and grounded chat can work.
              </p>
              <Link
                href="/"
                className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
              >
                Back to Mindy Locke
              </Link>
            </Step>

            <section className="rounded-xl border border-foreground/10 bg-popover p-4 space-y-2">
              <h2 className="text-section">Or use a vendor API instead</h2>
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                On the same Providers page you can paste a Groq, OpenAI, Anthropic, or Google key.
                Never paste AWS access keys — they are rejected.
              </p>
            </section>
          </>
        ) : (
          <>
            <Step n={1} title="Open Settings → Providers">
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                Connect Ollama on this machine, or Amazon Bedrock / a vendor key.
              </p>
              <Link
                href={PROVIDERS_DEEP_LINK}
                onClick={() => markBedrockHighlight()}
                className={cn(buttonVariants({ variant: "default" }), "h-10 px-4")}
              >
                Open Providers
              </Link>
            </Step>
            <Step n={2} title="Start Ollama or enable Bedrock">
              <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
                Local default is Ollama. Bedrock uses the same acknowledgement checkbox as the hosted install.
              </p>
            </Step>
          </>
        )}

        <p className="text-meta">
          This page is {GETTING_STARTED_PATH}. Bookmark it. It is a guide, not a chatbot.
        </p>
      </div>
    </div>
  );
}
