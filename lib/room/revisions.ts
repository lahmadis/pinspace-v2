import type { RevisionNode } from '@/components/room/RevisionStrip'

/**
 * Milestones for the revision strip.
 *
 * There is no revisions table and this pass adds no migration, so the three
 * review milestones are derived from the academic calendar rather than stored.
 * That still yields real dates and a genuinely correct active node — it just
 * cannot yet reflect a schedule an instructor has set by hand. Wiring this to
 * persisted per-room dates is the obvious follow-up.
 */
const MILESTONES: Array<{ number: number; label: string; at: number }> = [
  { number: 1, label: 'First Pin-Up', at: 0.25 },
  { number: 2, label: 'Mid-Review', at: 0.55 },
  { number: 3, label: 'Final Review', at: 0.97 },
]

export interface SemesterTerm {
  label: string
  start: Date
  end: Date
}

/** Fall runs Sep–Dec; Spring runs Jan–May. Anything else falls into Summer. */
export function currentTerm(now: Date): SemesterTerm {
  const year = now.getFullYear()
  const month = now.getMonth() // 0-indexed
  if (month >= 8) return { label: `Fall ${year}`, start: new Date(year, 8, 1), end: new Date(year, 11, 15) }
  if (month <= 4) return { label: `Spring ${year}`, start: new Date(year, 0, 15), end: new Date(year, 4, 10) }
  return { label: `Summer ${year}`, start: new Date(year, 4, 15), end: new Date(year, 7, 20) }
}

function formatDay(date: Date): string {
  return date
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    .toUpperCase()
}

/**
 * Build the strip's nodes. Exactly one node is `active`: the earliest one not
 * yet passed. Everything before it is `complete`, everything after `future`.
 */
export function buildRevisionNodes(now: Date): { nodes: RevisionNode[]; semester: string } {
  const term = currentTerm(now)
  const span = term.end.getTime() - term.start.getTime()

  const dated = MILESTONES.map((m) => ({
    ...m,
    date: new Date(term.start.getTime() + span * m.at),
  }))

  const activeIndex = dated.findIndex((m) => m.date.getTime() >= now.getTime())

  const nodes: RevisionNode[] = dated.map((m, i) => ({
    number: m.number,
    label: m.label,
    date: formatDay(m.date),
    status:
      activeIndex === -1
        ? 'complete'
        : i < activeIndex
          ? 'complete'
          : i === activeIndex
            ? 'active'
            : 'future',
  }))

  return {
    nodes,
    semester: `${formatDay(term.start)} – ${formatDay(term.end)} · ${term.label.toUpperCase()}`,
  }
}
