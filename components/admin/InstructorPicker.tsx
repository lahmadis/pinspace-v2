'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

export type UserSearchResult = {
  userId: string
  email: string | null
  fullName: string | null
  organizationId: string | null
  hasProfile: boolean
}

/**
 * Search-and-pick an EXISTING account. There is deliberately no free-text
 * email entry: workspaces.owner_id must point at a real user, or every
 * owner-gated action on the provisioned studio is dead on arrival.
 *
 * Lifted out of app/admin/page.tsx unchanged so the instructor detail page can
 * reuse the same creation form without a second copy of it.
 */
export default function InstructorPicker({
  selected,
  onSelect,
  emptyHint = 'No account matches. They must sign up before you can provision a studio for them.',
}: {
  selected: UserSearchResult | null
  onSelect: (user: UserSearchResult | null) => void
  /** Copy for the no-results state — the reason an account must already exist
   *  differs between provisioning a new studio and transferring an existing one. */
  emptyHint?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    // Debounced: the search scans the full user list server-side, so firing on
    // every keystroke would be wasteful.
    const timer = setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d: { users?: UserSearchResult[] }) => {
          if (!cancelled) setResults(Array.isArray(d.users) ? d.users : [])
        })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 border border-indigo-200 bg-indigo-50 rounded-lg">
        <div className="min-w-0">
          <p className="text-sm font-medium text-indigo-900 truncate">
            {selected.fullName || selected.email || selected.userId}
          </p>
          {selected.fullName && selected.email && (
            <p className="text-xs text-indigo-500 truncate">{selected.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { onSelect(null); setQuery('') }}
          className="p-1 text-indigo-400 hover:text-indigo-600 rounded shrink-0"
          aria-label="Clear selected instructor"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
      />
      {query.trim().length >= 2 && (
        <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
          {searching ? (
            <p className="px-3 py-2 text-xs text-gray-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">{emptyHint}</p>
          ) : (
            results.map((u) => (
              <button
                key={u.userId}
                type="button"
                onClick={() => onSelect(u)}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50/60"
              >
                <p className="text-sm text-gray-900">{u.fullName || u.email || u.userId}</p>
                {u.fullName && u.email && <p className="text-xs text-gray-400">{u.email}</p>}
                {!u.hasProfile && (
                  <p className="text-xs text-amber-600 mt-0.5">Has not completed onboarding</p>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
