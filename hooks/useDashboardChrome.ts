'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthSession } from '@/hooks/useAuthSession'
import type { Scope } from '@/components/dashboard/DashboardSidebar'

const SCOPE_KEY = 'pinspace-dashboard-scope'

/**
 * The sidebar's props, for a page that sits beside the dashboard.
 *
 * /archive hand-rolls this same block — auth redirect, admin flag, profile
 * name, organisation, sidebar open state, and a scope change that pushes back
 * to /dashboard. This is that block, extracted so anything new beside the
 * dashboard doesn't become another copy. /archive is deliberately left alone:
 * changing a working page is not this hook's job.
 */
export function useDashboardChrome() {
  const router = useRouter()
  const { status: authStatus, user } = useAuthSession()

  const [firstName, setFirstName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [organization, setOrganization] = useState<{ name: string; slug: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    Promise.all([
      fetch('/api/admin/me', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/user-profile', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([adminData, profile]) => {
        if (cancelled) return
        setIsAdmin(Boolean(adminData?.isAdmin))
        const fullName = typeof profile?.full_name === 'string' ? profile.full_name : null
        setFirstName(fullName ? fullName.trim().split(/\s+/)[0] || null : null)
        const org = profile?.organization
        setOrganization(org?.slug && org?.name ? { name: org.name, slug: org.slug } : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])

  /** The scope buttons belong to /dashboard; picking one navigates back to it. */
  const handleScopeChange = (scope: Scope) => {
    if (typeof window !== 'undefined') localStorage.setItem(SCOPE_KEY, scope)
    router.push('/dashboard')
  }

  return {
    authStatus,
    user,
    sidebarProps: {
      currentScope: 'personal' as Scope,
      onScopeChange: handleScopeChange,
      hasOrganization: Boolean(organization),
      orgName: organization?.name,
      firstName,
      userEmail: user?.email,
      isAdmin,
      isOpen: sidebarOpen,
      onToggle: () => setSidebarOpen((v) => !v),
    },
  }
}
