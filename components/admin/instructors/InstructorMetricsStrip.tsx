'use client'

import { UserCheck, UserPlus, Users } from 'lucide-react'
import { Card, MetricsSkeletonGrid } from '@/components/ui'
import type { AdminInstructor } from '@/types/admin'

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

export interface InstructorMetricsStripProps {
  instructors: AdminInstructor[]
  loading: boolean
}

export function InstructorMetricsStrip({ instructors, loading }: InstructorMetricsStripProps) {
  if (loading) {
    return (
      <div className="mb-6">
        <MetricsSkeletonGrid count={3} />
      </div>
    )
  }

  const total = instructors.length
  const activeOwners = instructors.filter((i) => i.classCount > 0).length
  const candidates = total - activeOwners

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
      <MetricCard label="Total Instructors" value={total} hint="All instructor accounts" icon={Users} />
      <MetricCard label="Active Studio Owners" value={activeOwners} hint="Owns 1 or more class rooms" icon={UserCheck} />
      <MetricCard label="Provisioning Candidates" value={candidates} hint="Can run a studio, no class yet" icon={UserPlus} />
    </div>
  )
}

export default InstructorMetricsStrip
