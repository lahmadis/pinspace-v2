/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdminShell } from '@/components/admin/AdminShell'
import { RecentSignupsTable } from '@/components/admin/signups/RecentSignupsTable'
import { SignupMetricsStrip } from '@/components/admin/signups/SignupMetricsStrip'
import { getAdminMeApi, getRecentSignupsApi } from '@/lib/api/admin'
import type { RecentSignup } from '@/types/admin'

export default function AdminSignupsPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [signups, setSignups] = useState<RecentSignup[]>([])
  const [loading, setLoading] = useState(true)

  const checkAdmin = useCallback(async () => {
    try {
      const data = await getAdminMeApi()
      if (!data.isAdmin) {
        router.replace('/dashboard')
        return false
      }
      setIsAdmin(true)
      return true
    } catch {
      router.replace('/dashboard')
      return false
    }
  }, [router])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRecentSignupsApi()
      setSignups(Array.isArray(data.signups) ? data.signups : [])
    } catch {
      setSignups([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAdmin().then((ok) => {
      if (ok) loadData()
    })
  }, [checkAdmin, loadData])

  return (
    <AdminShell
      currentPath="/admin/signups"
      title="Recent signups"
      description="Newest user registrations, status badges, and last sign-in telemetry."
    >
      <SignupMetricsStrip signups={signups} loading={loading} />
      <RecentSignupsTable
        signups={signups}
        loading={loading}
      />
    </AdminShell>
  )
}
