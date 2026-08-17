'use client'

import { UserCheck, UserPlus, AlertCircle } from 'lucide-react'
import { Card, MetricsSkeletonGrid } from '@/components/ui'
import type { RecentSignup } from '@/types/admin'

function MetricCard({ label, value, hint, icon: Icon }: { label: string; value: number; hint: string; icon: any }) {
  return (
    <Card className="p-4 flex items-start justify-between">
      <div>
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-text-primary tabular-nums mt-1">{value}</p>
        <p className="text-xs text-text-secondary mt-1">{hint}</p>
      </div>
      <div className="p-2 bg-primary-muted rounded text-accent">
        <Icon className="w-4.5 h-4.5" />
      </div>
    </Card>
  )
}

export interface SignupMetricsStripProps {
  signups: RecentSignup[]
  loading: boolean
}

export function SignupMetricsStrip({ signups, loading }: SignupMetricsStripProps) {
  if (loading) {
    return (
      <div className="mb-6">
        <MetricsSkeletonGrid count={3} />
      </div>
    )
  }

  const total = signups.length
  const active = signups.filter((s) => s.status === 'active').length
  const pending = total - active

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
      <MetricCard label="Total Signups" value={total} hint="Newest registrations" icon={UserPlus} />
      <MetricCard label="Active Accounts" value={active} hint="Completed onboarding profile" icon={UserCheck} />
      <MetricCard label="Pending / No Profile" value={pending} hint="Profile creation incomplete" icon={AlertCircle} />
    </div>
  )
}

export default SignupMetricsStrip
