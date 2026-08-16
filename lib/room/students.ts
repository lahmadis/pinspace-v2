import type { Board } from '@/types'
import { cleanDisplayName } from '@/lib/displayName'

export interface RoomStudent {
  /** Stable key: owner id when present, otherwise the normalised name. */
  id: string
  name: string
  initials: string
  /** Wall carrying most of this student's work — what the roster snaps to. */
  wallIndex: number
  /** Every wall they have work on, ascending. Usually one. */
  wallIndices: number[]
  boardIds: string[]
  boardCount: number
  calloutCount: number
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Collapse a room's boards into one row per student.
 *
 * Grouped by owner id where available so two students who happen to share a
 * display name stay distinct, falling back to the lowercased name for legacy
 * rows that predate owner_id. Boards whose owner cannot be resolved are dropped
 * rather than bucketed into an "Anonymous" row — see lib/displayName.ts.
 */
export function deriveRoomStudents(boards: Board[]): RoomStudent[] {
  const byKey = new Map<string, {
    name: string
    wallCounts: Map<number, number>
    boardIds: string[]
    callouts: number
  }>()

  for (const board of boards) {
    const name = cleanDisplayName(board.ownerName) || cleanDisplayName(board.studentName)
    if (!name) continue
    const key = board.ownerId || `name:${name.toLowerCase()}`

    let entry = byKey.get(key)
    if (!entry) {
      entry = { name, wallCounts: new Map(), boardIds: [], callouts: 0 }
      byKey.set(key, entry)
    }
    entry.boardIds.push(board.id)
    entry.callouts += board.calloutCount ?? 0
    const wall = board.position?.wallIndex
    if (typeof wall === 'number' && Number.isFinite(wall)) {
      entry.wallCounts.set(wall, (entry.wallCounts.get(wall) ?? 0) + 1)
    }
  }

  const students: RoomStudent[] = []
  for (const [id, entry] of byKey) {
    const wallIndices = Array.from(entry.wallCounts.keys()).sort((a, b) => a - b)
    // Primary wall = most boards; ties break to the lower index so the ordering
    // is stable across refetches rather than depending on Map iteration.
    let wallIndex = wallIndices[0] ?? 0
    let best = -1
    for (const w of wallIndices) {
      const count = entry.wallCounts.get(w) ?? 0
      if (count > best) {
        best = count
        wallIndex = w
      }
    }
    students.push({
      id,
      name: entry.name,
      initials: initialsFor(entry.name),
      wallIndex,
      wallIndices,
      boardIds: entry.boardIds,
      boardCount: entry.boardIds.length,
      calloutCount: entry.callouts,
    })
  }

  // Reading order: along the walls, then alphabetical within a wall.
  return students.sort(
    (a, b) => a.wallIndex - b.wallIndex || a.name.localeCompare(b.name),
  )
}
