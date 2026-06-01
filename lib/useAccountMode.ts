'use client'

import { useEffect, useState } from 'react'

export type AccountMode = 'university' | 'firm' | 'personal'

type CacheEntry = { mode: AccountMode; ready: boolean }
let cached: CacheEntry | null = null
let inflight: Promise<AccountMode> | null = null

async function loadMode(userEmail?: string | null): Promise<AccountMode> {
  if (cached?.ready) return cached.mode
  if (inflight) return inflight
  inflight = (async () => {
    let resolved: AccountMode = 'personal'
    try {
      const profileRes = await fetch('/api/user-profile', { cache: 'no-store' })
      if (!profileRes.ok) return resolved
      const profile = await profileRes.json().catch(() => null)
      const orgId: string | null = profile?.organization_id ?? null
      if (!orgId) {
        if (userEmail) {
          try {
            const claimRes = await fetch('/api/user-profile/claim-domain', { method: 'POST', cache: 'no-store' })
            if (claimRes.ok) {
              const claimData = await claimRes.json().catch(() => null)
              if (claimData?.claimed && claimData.organizationId) {
                const orgsRes = await fetch('/api/institutions', { cache: 'no-store' })
                const orgs = await orgsRes.json().catch(() => null)
                const list: Array<{ id: string; type?: string }> = orgs?.institutions ?? []
                const org = list.find((o) => o.id === claimData.organizationId)
                if (org?.type === 'firm') resolved = 'firm'
                else if (org?.type === 'university') resolved = 'university'
                return resolved
              }
            }
          } catch { /* non-fatal */ }
        }
        return resolved
      }
      const orgsRes = await fetch('/api/institutions', { cache: 'no-store' })
      if (!orgsRes.ok) return resolved
      const orgs = await orgsRes.json().catch(() => null)
      const list: Array<{ id: string; type?: string }> = orgs?.institutions ?? []
      const org = list.find((o) => o.id === orgId)
      if (org?.type === 'firm') resolved = 'firm'
      else if (org?.type === 'university') resolved = 'university'
      return resolved
    } catch {
      return resolved
    } finally {
      cached = { mode: resolved, ready: true }
      inflight = null
    }
  })()
  return inflight
}

export function useAccountMode(userId: string | null | undefined, userEmail?: string | null): {
  mode: AccountMode
  loading: boolean
} {
  const [mode, setMode] = useState<AccountMode>(cached?.mode ?? 'personal')
  const [loading, setLoading] = useState<boolean>(!cached?.ready && !!userId)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    if (cached?.ready) {
      setMode(cached.mode)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    loadMode(userEmail).then((m) => {
      if (cancelled) return
      setMode(m)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, loading }
}

export function resetAccountModeCache(): void {
  cached = null
  inflight = null
}
