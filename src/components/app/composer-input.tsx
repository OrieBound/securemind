"use client";

import { Mic, Square } from "lucide-react";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

export type ComposerInputHandle = {
  append: (text: string) => void;
  setValue: (text: string) => void;
  clear: () => void;
  focus: () => void;
  getValue: () => string;
  getSelection: () => { start: number; end: number };
};

/** Insert (or restore) voice text at a saved cursor/selection in the composer */
export type ComposerVoiceInsert = {
  text: string;
  base: string;
  selectionStart: number;
  selectionEnd: number;
};

export function mergeTranscription(
  base: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, base.length));
  const end = Math.max(start, Math.min(selectionEnd, base.length));
  const before = base.slice(0, start);
  const after = base.slice(end);

  let piece = insertion;
  if (start === end && end === base.length && base.length > 0 && piece.length > 0) {
    const needsSpace = !/\s$/.test(base) && !/^\s/.test(piece);
    if (needsSpace) piece = ` ${piece}`;
  }

  const text = before + piece + after;
  return { text, cursor: start + piece.length };
}

type ComposerInputProps = {
  workspaceName: string;
  sessionLoading: boolean;
  sessionReady: boolean;
  isStreaming: boolean;
  onSend: () => void;
  onCancelStream: () => void;
  onStartVoice: () => void;
  /** After voice: merge transcribed text at saved cursor, or restore base when text is empty */
  voiceInsert?: ComposerVoiceInsert | null;
  onVoiceInsertApplied?: () => void;
};

export const ComposerInput = memo(forwardRef<ComposerInputHandle, ComposerInputProps>(
  function ComposerInput(
    {
      workspaceName,
      sessionLoading,
      sessionReady,
      isStreaming,
      onSend,
      onCancelStream,
      onStartVoice,
      voiceInsert,
      onVoiceInsertApplied,
    },
    ref,
  ) {
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (!voiceInsert) return;
      const { text, base, selectionStart, selectionEnd } = voiceInsert;
      const merged = text
        ? mergeTranscription(base, selectionStart, selectionEnd, text)
        : { text: base, cursor: selectionStart };
      setDraft(merged.text);
      onVoiceInsertApplied?.();
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(merged.cursor, merged.cursor);
      });
    }, [voiceInsert, onVoiceInsertApplied]);

    useImperativeHandle(ref, () => ({
      append: (text: string) => setDraft(prev => prev + text),
      setValue: (text: string) => setDraft(text),
      clear: () => setDraft(""),
      focus: () => inputRef.current?.focus(),
      getValue: () => inputRef.current?.value ?? draft,
      getSelection: () => {
        const el = inputRef.current;
        if (!el) return { start: draft.length, end: draft.length };
        return {
          start: el.selectionStart ?? draft.length,
          end: el.selectionEnd ?? draft.length,
        };
      },
    }), [draft]);

    const canSend = draft.trim().length > 0 && sessionReady && !sessionLoading;

    return (
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <label className="sr-only" htmlFor="composer">Message {workspaceName}</label>
        <input
          id="composer"
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={sessionLoading ? "Loading conversation…" : `Message ${workspaceName}`}
          disabled={isStreaming || sessionLoading || !sessionReady}
          autoComplete="off"
          className="flex-1 bg-transparent text-sm text-white/90 placeholder:text-white/25 outline-none border-none"
        />
        <button
          type="button"
          onClick={onStartVoice}
          aria-label="Voice input"
          disabled={isStreaming}
          className={cn(
            "shrink-0 p-1.5 rounded-lg transition-colors",
            "text-white/25 hover:text-white/60 hover:bg-white/6",
            isStreaming && "opacity-30 pointer-events-none",
          )}
        >
          <Mic className="size-4" aria-hidden />
        </button>
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancelStream}
            aria-label="Stop response"
            className="shrink-0 size-8 rounded-xl flex items-center justify-center bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-all"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "shrink-0 size-8 rounded-xl flex items-center justify-center transition-all",
              canSend
                ? "bg-primary text-primary-foreground hover:brightness-110 shadow-lg shadow-indigo-900/40"
                : "bg-white/6 text-white/20 cursor-not-allowed",
            )}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        )}
      </div>
    );
  },
));
