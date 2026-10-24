"use client";

import { ChatMarkdown } from "@/components/app/chat-markdown";

const FENCE = "```";

const SAMPLES: Array<{ label: string; content: string; streaming?: boolean; truncated?: boolean }> = [
  {
    label: "Word document",
    content: [
      "Here is the onboarding guide as a Word document.",
      "",
      `${FENCE}file:onboarding-guide.docx`,
      "# New starter checklist",
      "Complete these in your **first week**.",
      "",
      "## Accounts",
      "1. Sign in to SecureMind and turn on *two-step verification*.",
      "2. Ask your admin for access to the `Harbour Launch` workspace.",
      "   - Bring your laptop serial number.",
      "",
      "## Contacts",
      "| Team | Contact |",
      "| --- | --- |",
      "| IT | it-help@example.com |",
      "| Facilities | Front desk |",
      FENCE,
      "",
      "Open it in Word to edit.",
    ].join("\n"),
  },
  {
    label: "Excel workbook with two sheets (includes a formula-like cell)",
    content: [
      "Preparing the inventory workbook.",
      "",
      `${FENCE}file:inventory.xlsx`,
      "--- sheet: Stock ---",
      "Item,Qty,Code,Note",
      "Bolts,120,00123,=1+1",
      '"Washers, steel",450,00456,ok',
      "--- sheet: Suppliers ---",
      "Name,Country",
      "Acme,Canada",
      FENCE,
    ].join("\n"),
  },
  {
    label: "CSV",
    content: `Here it is.\n\n${FENCE}file:open-incidents.csv\nid,severity,owner\nINC-1,high,Dana\nINC-2,low,Sam\n${FENCE}`,
  },
  {
    label: "Log file",
    content: `${FENCE}file:nginx-error.log\n2026/10/23 09:14:02 [error] 311#0: *42 connect() failed (111: Connection refused)\n2026/10/23 09:14:05 [warn] 311#0: upstream server temporarily disabled\n${FENCE}`,
  },
  {
    label: "Still streaming",
    content: `Preparing the CSV now.\n\n${FENCE}file:report.csv\nmonth,total\njan,10\nfeb,`,
    streaming: true,
  },
  {
    label: "Cut off (hit the reply limit)",
    content: `${FENCE}file:big-list.csv\nn,square\n1,1\n2,4\n3,`,
    truncated: true,
  },
  {
    label: "Unsafe type is saved as text",
    content: `${FENCE}file:cleanup.bat\n@echo off\ndel /q temp\\*\n${FENCE}`,
  },
  {
    label: "Ordinary table and code block",
    content: "| Region | Sales |\n| --- | --- |\n| East | 120 |\n| West | 95 |\n\n```bash\nnpm run dev\n```",
  },
];

export function FilePreview() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-5 py-8">
      {SAMPLES.map(s => (
        <section key={s.label}>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{s.label}</p>
          <div className="chat-prose min-w-0 max-w-full">
            <ChatMarkdown content={s.content} streaming={s.streaming} truncated={s.truncated} />
          </div>
        </section>
      ))}
    </div>
  );
}
