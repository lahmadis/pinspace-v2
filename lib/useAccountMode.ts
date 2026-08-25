'use client'

import { useEffect, useState } from 'react'

export type AccountMode = 'university' | 'firm' | 'personal'

type CacheEntry = { mode: AccountMode; ready: boolean }
let cached: CacheEntry | null = null
let inflight: Promise<AccountMode | null> | null = null
// Bumped by resetAccountModeCache. A load that was already in flight when the
// cache was reset (leave-org, sign-out) describes the OLD account: it must not
// write its result into `cached`, and must not null out an `inflight` that now
// belongs to a newer generation.
let generation = 0

/**
 * Classify an organizations row. Returns null when the row is missing or its
 * type isn't one we recognise — i.e. the user HAS an org we failed to look up,
 * which is "unknown", never "personal".
 */
function classifyOrg(org: { type?: string } | undefined): AccountMode | null {
  if (org?.type === 'firm') return 'firm'
  if (org?.type === 'university') return 'university'
  return null
}

/**
 * Resolve the account mode, or null when it could not be determined.
 *
 * null is NOT 'personal'. Every failure path here used to collapse into
 * 'personal', and the old `finally` then cached that as ready:true — so a
 * single transient 5xx pinned the whole session into personal mode for the
 * module's lifetime, hiding the org tab from university users and stripping the
 * publish control from instructors. Failures now return null and leave `cached`
 * untouched, so the next mount retries. Only a positively determined mode is
 * ever cached.
 *
 * 'personal' is returned ONLY on the path that proves it: the profile loaded
 * cleanly and carries no organization_id, and no domain claim upgraded it.
 */
async function loadMode(userEmail?: string | null): Promise<AccountMode | null> {
  if (cached?.ready) return cached.mode
  if (inflight) return inflight

  const gen = generation
  inflight = (async (): Promise<AccountMode | null> => {
    try {
      const profileRes = await fetch('/api/user-profile', { cache: 'no-store' })
      if (!profileRes.ok) return null
      const profile = await profileRes.json().catch(() => null)
      const orgId: string | null = profile?.organization_id ?? null

      if (!orgId) {
        if (userEmail) {
          try {
            const claimRes = await fetch('/api/user-profile/claim-domain', { method: 'POST', cache: 'no-store' })
            if (claimRes.ok) {
              const claimData = await claimRes.json().catch(() => null)
              if (claimData?.claimed && claimData.organizationId) {
                // The claim just granted an org, so this user is definitively
                // not personal. Failing to classify it now is unknown.
                const orgsRes = await fetch('/api/institutions', { cache: 'no-store' })
                if (!orgsRes.ok) return null
                const orgs = await orgsRes.json().catch(() => null)
                const list: Array<{ id: string; type?: string }> = orgs?.institutions ?? []
                return classifyOrg(list.find((o) => o.id === claimData.organizationId))
              }
            }
          } catch {
            // A failed claim attempt does not create an org, so the profile's
            // "no organization_id" still stands: this really is a personal
            // account. Fall through rather than reporting unknown.
          }
        }
        return 'personal'
      }

      const orgsRes = await fetch('/api/institutions', { cache: 'no-store' })
      if (!orgsRes.ok) return null
      const orgs = await orgsRes.json().catch(() => null)
      const list: Array<{ id: string; type?: string }> = orgs?.institutions ?? []
      return classifyOrg(list.find((o) => o.id === orgId))
    } catch {
      return null
    }
  })()
    // Cache inside the chain, not at the call site, so concurrent callers that
    // received this same promise from the `inflight` short-circuit above also
    // observe the cached result.
    .then((mode) => {
      // Superseded by a reset while we were fetching: the answer describes an
      // account state that no longer applies, so report it as undetermined
      // rather than caching it. The next mount starts a fresh load.
      if (gen !== generation) return null
      if (mode !== null) cached = { mode, ready: true }
      return mode
    })
    .finally(() => {
      if (gen === generation) inflight = null
    })

  return inflight
}

/**
 * `mode` is only meaningful when `resolved` is true. On an unresolved load it
 * holds the 'personal' default, which callers gating on `mode !== 'personal'`
 * must NOT treat as a real personal account — check `resolved` first.
 */
export function useAccountMode(userId: string | null | undefined, userEmail?: string | null): {
  mode: AccountMode
  loading: boolean
  resolved: boolean
} {
  const [mode, setMode] = useState<AccountMode>(cached?.mode ?? 'personal')
  const [resolved, setResolved] = useState<boolean>(Boolean(cached?.ready))
  const [loading, setLoading] = useState<boolean>(!cached?.ready && !!userId)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    // State is seeded from this module cache during render, so a ready cache
    // normally needs no mirror update. Re-apply it asynchronously for the race
    // where another caller filled the shared cache after this render began.
    if (cached?.ready) {
      const ready = cached
      queueMicrotask(() => {
        if (cancelled) return
        setMode(ready.mode)
        setResolved(true)
        setLoading(false)
      })
      return () => {
        cancelled = true
      }
    }
    queueMicrotask(() => {
      if (!cancelled) setLoading(true)
    })
    loadMode(userEmail)
      .then((m) => {
        if (cancelled) return
        // Leave `mode` on its default when the load failed; `resolved` is what
        // tells callers the default is not an answer.
        if (m !== null) {
          setMode(m)
          setResolved(true)
        } else {
          setResolved(false)
        }
        setLoading(false)
      })
      // loadMode swallows its own errors, so this is belt-and-braces — but a
      // rejection escaping it would leave loading=true forever, which is the
      // one remaining route to a permanently stuck personal scope. Always
      // clear the flag.
      .catch(() => {
        if (cancelled) return
        setResolved(false)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, loading: Boolean(userId) && loading, resolved }
}

export function resetAccountModeCache(): void {
  generation += 1
  cached = null
  inflight = null
}
