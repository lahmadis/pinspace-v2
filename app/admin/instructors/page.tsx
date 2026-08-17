'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdminShell } from '@/components/admin/AdminShell'
import { InstructorsTable } from '@/components/admin/instructors/InstructorsTable'
import { InstructorMetricsStrip } from '@/components/admin/instructors/InstructorMetricsStrip'
import { getAdminMeApi, getAdminInstructorsApi } from '@/lib/api/admin'
import type { AdminInstructor } from '@/types/admin'

export default function AdminInstructorsPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [instructors, setInstructors] = useState<AdminInstructor[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

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
    setFailed(false)
    try {
      const data = await getAdminInstructorsApi()
      setInstructors(Array.isArray(data.instructors) ? data.instructors : [])
      setFailed(Boolean(data.failed))
    } catch {
      setInstructors([])
      setFailed(true)
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
      currentPath="/admin/instructors"
      title="Instructor directory"
      description="Overview of accounts that teach or own class studios across all organizations."
    >
      <InstructorMetricsStrip instructors={instructors} loading={loading} />
      <InstructorsTable
        instructors={instructors}
        loading={loading}
        failed={failed}
      />
    </AdminShell>
  )
}
