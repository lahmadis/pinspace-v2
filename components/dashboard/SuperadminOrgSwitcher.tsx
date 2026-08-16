'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'

import { Select } from '@/components/ui'

interface Org {
  id: string
  name: string
  slug: string | null
}

/**
 * Superadmin-only org switcher for the dashboard sidebar.
 *
 * Self-gating: it calls GET /api/superadmin/orgs, which returns 403 for
 * non-superadmins (server-verified). On 403/any failure the component renders
 * NOTHING, so non-superadmins never see it. On success it lists every org;
 * selecting one opens that org's network view (read-only) at /explore?org=<id>,
 * where the explore endpoints re-verify superadmin server-side before honoring
 * the org. UI visibility is never the security boundary — the endpoints are.
 */
export function SuperadminOrgSwitcher() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<Org[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/superadmin/orgs', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && Array.isArray(data.orgs)) setOrgs(data.orgs)
      })
      .catch(() => {
        /* not a superadmin (403) or network error — stay hidden */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Render nothing for non-superadmins (no orgs payload) or while loading.
  if (!orgs || orgs.length === 0) return null

  return (
    <div className="px-1 pb-1 pt-3">
      <label
        htmlFor="superadmin-organization-network"
        className="mb-1.5 flex items-center gap-1.5 px-2 font-mono text-[0.68rem] font-semibold uppercase tracking-wide text-text-muted"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        Superadmin organization network
      </label>
      <Select
        id="superadmin-organization-network"
        defaultValue=""
        onChange={(e) => {
          const id = e.target.value
          if (id) router.push(`/explore?org=${encodeURIComponent(id)}`)
        }}
        className="text-sm"
      >
        <option value="" disabled>
          Select an organization…
        </option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
    </div>
  )
}
