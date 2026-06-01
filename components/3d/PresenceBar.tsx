'use client'

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
}

/** Deterministic avatar color from a user id, so a given user is always the same hue. */
function colorFor(userId: string): string {
  const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#3b82f6']
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
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
      className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/15 backdrop-blur-md rounded-xl shadow-lg border border-white/20"
      role="status"
      aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} editing this room`}
    >
      <div className="flex -space-x-2">
        {shown.map((u) => (
          <div
            key={u.userId}
            title={u.fullName}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white ring-2 ring-white/40"
            style={{ backgroundColor: colorFor(u.userId) }}
          >
            {initialsFor(u.fullName)}
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white bg-gray-500 ring-2 ring-white/40">
            +{overflow}
          </div>
        )}
      </div>
      <span className="text-white/90 text-xs font-medium hidden sm:inline">
        {others.length === 1 ? 'is also here' : 'are also here'}
      </span>
    </div>
  )
}
