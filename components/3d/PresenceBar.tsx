'use client'

import { ENGINE_PALETTE } from './enginePalette'

/**
 * Tier 1 presence indicator: shows initials/avatars of OTHER members currently
 * in the same room (the current user is excluded). Fed by the
 * `studio-presence:{roomId}` Supabase Realtime channel in the studio page.
 * Purely informational — no data-model impact.
 */

export interface PresentUser {
  userId: string
  fullName: string
  /** Wall index this user is currently editing (0-based), or null when not in a wall. */
  wallIndex?: number | null
  /** Whether this user is currently presenting (Phase B.1 live-crit presenter state). */
  isPresenting?: boolean
  /** ms-epoch the user was last (re-)tracked; used to break presenter ties. */
  joinedAt?: number
}

/** Deterministic avatar color from a user id, so a given user is always the same hue. */
export function colorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return ENGINE_PALETTE.collaborator[hash % ENGINE_PALETTE.collaborator.length]
}

/**
 * Phase B.3: a friendly display name. When the only name we have is an email
 * (full_name/name missing), show the local part (e.g. "lahmadis@wit.edu" →
 * "lahmadis", separators → spaces) instead of the full address. Non-email names
 * pass through unchanged. Pure presentation — does not touch presence data.
 */
export function friendlyName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim()
  if (!name) return 'Someone'
  const at = name.indexOf('@')
  if (at <= 0) return name // not email-like → use as-is
  const local = name.slice(0, at).replace(/[._-]+/g, ' ').trim()
  return local || name
}

function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function PresenceBar({
  users,
  currentUserId,
}: {
  users: PresentUser[]
  currentUserId: string | null
}) {
  // Dedupe by userId (a user with two tabs tracks twice) and drop self.
  const seen = new Set<string>()
  const others: PresentUser[] = []
  for (const u of users) {
    if (!u.userId || u.userId === currentUserId || seen.has(u.userId)) continue
    seen.add(u.userId)
    others.push(u)
  }

  if (others.length === 0) return null

  const MAX_SHOWN = 5
  const shown = others.slice(0, MAX_SHOWN)
  const overflow = others.length - shown.length

  return (
    <div
      className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex max-w-[calc(100vw-7rem)] -translate-x-1/2 items-center gap-2 overflow-hidden rounded-pinspace border border-border/40 bg-primary-dark/80 px-3 py-2 shadow-[var(--shadow-raised)] backdrop-blur-md motion-reduce:transition-none"
      role="status"
      aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} editing this room`}
    >
      <div className="flex shrink-0 -space-x-2">
        {shown.map((u) => {
          const display = friendlyName(u.fullName)
          return (
            <div
              key={u.userId}
              title={display}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-background-light/60"
              style={{ backgroundColor: colorFor(u.userId) }}
            >
              {initialsFor(display)}
            </div>
          )
        })}
        {overflow > 0 && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-text-secondary text-[11px] font-semibold text-white ring-2 ring-background-light/60">
            +{overflow}
          </div>
        )}
      </div>
      <span className="hidden truncate text-xs font-medium text-background-light sm:inline">
        {others.length === 1 ? 'is also here' : 'are also here'}
      </span>
    </div>
  )
}
