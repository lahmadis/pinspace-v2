/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  Building2,
  ChevronRight,
  GraduationCap,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { Card, MetricsSkeletonGrid, SegmentedControl } from '@/components/ui'
import { AdminShell } from '@/components/admin/AdminShell'
import { CreateOrgModal } from '@/components/admin/institutions/CreateOrgModal'
import CreateStudioForm from '@/components/admin/CreateStudioForm'
import {
  getAdminMeApi,
  getAdminOverviewApi,
  getAdminStatsApi,
  getAdminStudiosApi,
  getRecentSignupsApi,
} from '@/lib/api/admin'
import type { AdminStats, AdminStudio, InstitutionWithCount, RecentSignup } from '@/types/admin'
import { AreaTrendChart } from '@/components/admin/analytics/AreaTrendChart'
import { AcademicYearDonutChart } from '@/components/admin/analytics/AcademicYearDonutChart'
import { MajorBarChart } from '@/components/admin/analytics/MajorBarChart'
import { AcquisitionBarChart } from '@/components/admin/analytics/AcquisitionBarChart'
import { HealthGaugesCard } from '@/components/admin/analytics/HealthGaugesCard'

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: number | string; hint?: string; icon: any }) {
  return (
    <Card className="p-5 flex items-start justify-between">
      <div>
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-text-primary tabular-nums mt-1">{value}</p>
        {hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
      </div>
      <div className="p-2.5 bg-primary-muted rounded-lg text-accent">
        <Icon className="w-5 h-5" />
      </div>
    </Card>
  )
}


const SUB_ROUTES = [
  { label: 'Studios & Classrooms', href: '/admin/studios', description: 'Provision pilot studios, transfer owners & manage members.', icon: GraduationCap },
  { label: 'Instructor Directory', href: '/admin/instructors', description: 'Roster of accounts that teach or own class rooms.', icon: UserCheck },
  { label: 'Users & Account Roles', href: '/admin/users', description: 'Promote or demote student and instructor roles.', icon: Users },
  { label: 'Institutions & Firms', href: '/admin/institutions', description: 'Schools, design firms, and verified email domains.', icon: Building2 },
  { label: 'Account Signups', href: '/admin/signups', description: 'Live account registration feed and activity.', icon: UserPlus },
]

export default function AdminOverviewPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [institutions, setInstitutions] = useState<InstitutionWithCount[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [studios, setStudios] = useState<AdminStudio[]>([])
  const [signups, setSignups] = useState<RecentSignup[]>([])

  const checkAdmin = useCallback(async () => {
    try {
      const me = await getAdminMeApi()
      if (!me.isAdmin) {
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

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [overviewData, statsData, studiosData, signupsData] = await Promise.all([
        getAdminOverviewApi().catch(() => ({ institutions: [] })),
        getAdminStatsApi().catch(() => null),
        getAdminStudiosApi().catch(() => ({ studios: [] })),
        getRecentSignupsApi().catch(() => ({ signups: [] })),
      ])

      setInstitutions(overviewData.institutions || [])
      setStats(statsData)
      setStudios(studiosData.studios || [])
      setSignups(signupsData.signups || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAdmin().then((ok) => {
      if (ok) loadAll()
    })
  }, [checkAdmin, loadAll])

  const [range, setRange] = useState<'7D' | '30D' | '90D' | 'YTD' | 'ALL'>('30D')

  const totalUsers = stats?.total || 0
  const schoolsCount = institutions.filter((i) => (i.type ?? 'university') === 'university').length

  // Filter signups dynamically based on selected range
  const now = new Date()
  const days = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : range === 'YTD' ? 180 : 365
  const cutoffDate = new Date(now)
  cutoffDate.setDate(cutoffDate.getDate() - days)

  const rangeSignups = signups.filter((s) => {
    if (!s.createdAt) return true
    return new Date(s.createdAt) >= cutoffDate
  })

  const verifiedSignups = rangeSignups.filter((s) => s.status !== 'unverified').length
  const memberStudios = studios.filter((s) => s.adminIsMember || s.provisionedByAdmin).length

  return (
    <AdminShell
      currentPath="/admin"
      title="Executive Overview"
      description="PinSpace platform telemetry, operational metrics, and quick actions."
      actions={
        <div className="flex items-center gap-2">
          <CreateOrgModal onCreated={loadAll} />
          <CreateStudioForm onCreated={loadAll} />
        </div>
      }
    >
      {/* 4 Summary Stat Cards */}
      <div className="mb-8">
        {loading ? (
          <MetricsSkeletonGrid count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Users" value={totalUsers} hint="Registered platform accounts" icon={Users} />
            <StatCard label="Institutions & Firms" value={institutions.length} hint={`${schoolsCount} schools`} icon={Building2} />
            <StatCard label="Class Studios" value={studios.length} hint="Active studio rooms" icon={GraduationCap} />
            <StatCard label="Recent Signups" value={signups.length} hint="Latest account activity" icon={UserPlus} />
          </div>
        )}
      </div>

      {/* Universal Time Range Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 bg-background-lighter/60 border border-border p-3.5 rounded-xl">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-accent" />
          <span className="text-xs font-bold text-text-primary uppercase tracking-wider">Universal Range Filter</span>
          <span className="text-xs text-text-secondary">({rangeSignups.length} signups in window)</span>
        </div>

        <SegmentedControl
          value={range}
          onChange={(v) => setRange(v as any)}
          options={[
            { value: '7D', label: '7D' },
            { value: '30D', label: '30D' },
            { value: '90D', label: '90D' },
            { value: 'YTD', label: 'YTD' },
            { value: 'ALL', label: 'ALL' },
          ]}
        />
      </div>

      {/* Real Dynamic Platform Health Telemetry Gauges */}
      <HealthGaugesCard
        totalUsers={totalUsers}
        profileCount={stats?.total || 0}
        totalSignups={rangeSignups.length || signups.length}
        activeSignups={verifiedSignups}
        totalStudios={studios.length}
        memberStudios={memberStudios}
        loading={loading}
      />

      {/* Area Trend Growth Chart */}
      <div className="mb-8">
        <AreaTrendChart signups={rangeSignups.length > 0 ? rangeSignups : signups} loading={loading} selectedRange={range} />
      </div>

      {/* Real Dynamic Demographic Breakdown Grid */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">Demographic Telemetry</h2>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <AcademicYearDonutChart byYear={stats?.by_year} total={totalUsers} loading={loading} />
          <MajorBarChart byMajor={stats?.by_major} total={totalUsers} loading={loading} />
          <AcquisitionBarChart byHowHeard={stats?.by_how_heard} byAgeRange={stats?.by_age_range} total={totalUsers} loading={loading} />
        </div>
      </div>

      {/* Sub-Route Navigation Shortcut Cards */}
      <div>
        <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-3">Admin Control Plane</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUB_ROUTES.map((route) => {
            const Icon = route.icon
            return (
              <Link key={route.href} href={route.href} className="group">
                <Card className="p-4 h-full transition-all group-hover:border-accent group-hover:bg-primary-muted/40 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 bg-primary-muted rounded text-accent">
                        <Icon className="w-4 h-4" />
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-dim group-hover:text-accent transition-colors" />
                    </div>
                    <p className="font-semibold text-sm text-text-primary group-hover:text-accent transition-colors">
                      {route.label}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">{route.description}</p>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </AdminShell>
  )
}
