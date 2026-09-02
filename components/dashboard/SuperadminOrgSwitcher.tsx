'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'

interface Org {
  id: string
  name: string
  slug: string | null
}

/**
 * Superadmin-only org switcher.
 *
 * Self-gating: it calls GET /api/superadmin/orgs, which returns 403 for
 * non-superadmins (server-verified). On 403/any failure the component renders
 * NOTHING, so non-superadmins never see it. On success it lists every org;
 * selecting one opens that org's network view (read-only) at /explore?org=<id>,
 * where the explore endpoints re-verify superadmin server-side before honoring
 * the org. UI visibility is never the security boundary — the endpoints are.
 *
 * BUILT FOR THE BAR, not the sidebar it came from. It used to be a `w-full`
 * block with a two-line uppercase label stacked over a full-width select —
 * correct in a 256px column, and roughly 270px of a horizontal row. Dropped
 * into the top bar unchanged it was the widest thing in the tab group, which
 * pushed the section switcher, Join and New Section onto a second line and left
 * the wordmark centred against a two-row bar instead of level with the tabs.
 *
 * So: one control the size of the buttons beside it. The label it needs is a
 * real one, just not a drawn one — an aria-label, because a superadmin knows
 * what the globe is and everyone else never sees it.
 */
export function SuperadminOrgSwitcher() {
  const router = useRouter()
  const selectId = useId()
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
    <div className="relative flex shrink-0 items-center">
      <Globe
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#8A8FA0]"
      />
      <select
        id={selectId}
        // The accessible name the drawn label used to carry. Kept as a real
        // name rather than a placeholder: a select whose only description is
        // its first option announces as unlabelled.
        aria-label="Superadmin organization network"
        defaultValue=""
        onChange={(e) => {
          const id = e.target.value
          if (id) router.push(`/explore?org=${encodeURIComponent(id)}`)
        }}
        className="max-w-[9.5rem] cursor-pointer truncate rounded-full border border-[#16181D]/[0.12] bg-white py-2 pl-8 pr-3 text-sm font-semibold text-[#5A5E6B] transition-colors hover:bg-[#16181D]/[0.04] focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
      >
        <option value="" disabled>
          View org…
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
