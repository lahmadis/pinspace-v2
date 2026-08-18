'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'

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
    <div className="px-1 pt-2 pb-1">
      <label className="flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        <Globe className="w-3 h-3" />
        Superadmin · view org network
      </label>
      <select
        defaultValue=""
        onChange={(e) => {
          const id = e.target.value
          if (id) router.push(`/explore?org=${encodeURIComponent(id)}`)
        }}
        className="w-full text-sm rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="" disabled>
          Select an organization…
        </option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </div>
  )
}
