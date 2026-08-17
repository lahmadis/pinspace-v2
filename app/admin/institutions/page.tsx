'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdminShell } from '@/components/admin/AdminShell'
import { InstitutionsTable } from '@/components/admin/institutions/InstitutionsTable'
import { OrgMetricsStrip } from '@/components/admin/institutions/OrgMetricsStrip'
import { CreateOrgModal } from '@/components/admin/institutions/CreateOrgModal'
import { EditOrgModal } from '@/components/admin/institutions/EditOrgModal'
import { getAdminMeApi, getAdminOverviewApi } from '@/lib/api/admin'
import type { InstitutionWithCount } from '@/types/admin'

export default function AdminInstitutionsPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [institutions, setInstitutions] = useState<InstitutionWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [editingInst, setEditingInst] = useState<InstitutionWithCount | null>(null)

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
      const data = await getAdminOverviewApi()
      setInstitutions(Array.isArray(data.institutions) ? data.institutions : [])
    } catch {
      setInstitutions([])
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
      currentPath="/admin/institutions"
      title="Institutions & design firms"
      description="Manage universities, design firms, and email domain security rules."
      actions={<CreateOrgModal onCreated={loadData} />}
    >
      <OrgMetricsStrip institutions={institutions} loading={loading} />
      <InstitutionsTable
        list={institutions}
        loading={loading}
        onEdit={(inst) => setEditingInst(inst)}
      />

      {editingInst && (
        <EditOrgModal
          inst={editingInst}
          onClose={() => setEditingInst(null)}
          onSaved={loadData}
        />
      )}
    </AdminShell>
  )
}
