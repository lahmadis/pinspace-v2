'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdminShell } from '@/components/admin/AdminShell'
import { AdminStudiosTable } from '@/components/admin/studios/AdminStudiosTable'
import { StudioMetricsStrip } from '@/components/admin/studios/StudioMetricsStrip'
import { getAdminMeApi, getAdminStudiosApi } from '@/lib/api/admin'
import type { AdminStudio } from '@/types/admin'

export default function AdminStudiosPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [studios, setStudios] = useState<AdminStudio[]>([])
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
      const data = await getAdminStudiosApi()
      setStudios(Array.isArray(data.studios) ? data.studios : [])
    } catch {
      setStudios([])
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
      currentPath="/admin/studios"
      title="Studio management"
      description="Provision pilot studios for professors, manage memberships, and reassign ownership."
    >
      <StudioMetricsStrip studios={studios} loading={loading} />
      <AdminStudiosTable
        studios={studios}
        loading={loading}
        onChanged={loadData}
      />
    </AdminShell>
  )
}
