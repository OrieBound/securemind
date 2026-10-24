import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tells someone without Admin access why a control is missing or greyed out, and who can change it.
 * Used wherever the page is view-only for a member, so "why can't I change this?" has an answer on
 * the page itself.
 */
export function AdminOnlyNotice({
  children,
  compact = false,
  className,
}: {
  /** What this person can do instead. Optional. */
  children?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-[var(--border-strong)] bg-muted text-foreground/75",
        compact ? "px-2.5 py-2 text-[0.72rem] leading-relaxed" : "px-3.5 py-3 text-[0.8rem] leading-relaxed",
        className,
      )}
    >
      <Lock className={cn("shrink-0 text-foreground/55", compact ? "mt-0.5 size-3.5" : "mt-0.5 size-4")} aria-hidden />
      <div>
        <p className="font-semibold text-foreground/90">Only an Admin can change this</p>
        <p className="text-foreground/65">
          {children ?? "You can see how it is set up. If something needs to change, ask your administrator."}
        </p>
      </div>
    </div>
  );
}
