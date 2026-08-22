/**
 * The two halves of a desk crit.
 *
 * A crit column has a public top — the work you will actually put in front of
 * the critic — and a private bottom: your own notes, the recording, the things
 * you told yourself to do. Everything in both halves is a canvas_node, so the
 * zone has to be recorded on the node itself.
 *
 * In `props`, not a column: migration 036 made props deliberately schemaless
 * for exactly this, and a new column would need a migration for what is
 * presentation grouping rather than a new kind of object.
 *
 * NOTE the privacy here is UI-level today. Every node on a personal crit is
 * already invisible to everyone but its owner (migration 038), so "shared with
 * prof" describes what you intend to show, not a permission. When sharing
 * arrives, this is the field it keys on — and until then the label must not
 * promise more than it delivers.
 */

export const DESK_ZONES = ['shared', 'private'] as const
export type DeskZone = (typeof DESK_ZONES)[number]

/** Nodes written before zones existed. Treated as private: the safe default. */
export const DEFAULT_ZONE: DeskZone = 'private'

export function zoneOf(props: Record<string, unknown> | null | undefined): DeskZone {
  const raw = props?.zone
  return raw === 'shared' ? 'shared' : DEFAULT_ZONE
}

/**
 * Where a crit sits in time, for the status pill.
 *
 * Derived from the date rather than stored. A crit does not have a workflow —
 * it happened or it hasn't — and a status column would immediately need
 * somewhere to be set, which is a feature nobody asked for.
 */
export type CritStage = 'today' | 'past' | 'upcoming'

export function critStage(createdAt: string, now = new Date()): CritStage {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return 'past'
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return 'today'
  return d.getTime() > now.getTime() ? 'upcoming' : 'past'
}

export function stageLabel(stage: CritStage): string {
  return stage === 'today' ? 'Today' : stage === 'upcoming' ? 'Planned' : 'Reviewed'
}

/** Short chip date, e.g. "Sep 9". */
export function critChipDate(createdAt: string): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
