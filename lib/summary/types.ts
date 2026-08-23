/**
 * The shape of a crit summary, and the bounds it has to fit.
 *
 * Imports nothing, like the sibling types modules under lib, so the browser and
 * any future server route share one definition.
 *
 * There WAS a prompt builder and a reply parser here, for a flow where the user
 * pasted the transcript into claude.ai and pasted the answer back. That is
 * gone: summarising is done offline now by lib/summary/localSummary.ts, which
 * costs nothing and needs no key. When a real provider is wired up it produces
 * a ParsedCritSummary like everything else, and nothing downstream changes.
 */

export interface ParsedDeliverable {
  title: string
  detail?: string
  /** As spoken — "before next Tuesday", "for the final review". Never a date. */
  due?: string
}

export interface ParsedCritSummary {
  summary: string
  deliverables: ParsedDeliverable[]
}

/** Bounds matching migration 040's CHECK constraints. */
export const MAX_SUMMARY_CHARS = 20000
export const MAX_DELIVERABLE_TITLE = 500
export const MAX_DELIVERABLE_DETAIL = 4000
export const MAX_DELIVERABLE_DUE = 200
/** More than this from one crit means the parse went wrong, not that you're busy. */
export const MAX_DELIVERABLES = 50

/**
 * Truncate without splitting a character in half.
 *
 * A plain `.slice()` counts UTF-16 units, so cutting mid-emoji leaves a lone
 * surrogate — which Postgres rejects outright (22P05), turning a too-long title
 * into a 500 rather than a truncated title. Rare, but the input here is speech
 * transcription, which carries the odd emoji.
 */
export function safeSlice(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastCode = cut.charCodeAt(cut.length - 1)
  // A high surrogate at the very end has lost its pair.
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut
}
