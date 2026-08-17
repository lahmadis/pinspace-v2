'use client'

import { GraduationCap, Layers, Sparkles } from 'lucide-react'
import { Card, MetricsSkeletonGrid } from '@/components/ui'
import type { AdminStudio } from '@/types/admin'

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

export interface StudioMetricsStripProps {
  studios: AdminStudio[]
  loading: boolean
}

export function StudioMetricsStrip({ studios, loading }: StudioMetricsStripProps) {
  if (loading) {
    return (
      <div className="mb-6">
        <MetricsSkeletonGrid count={3} />
      </div>
    )
  }

  const total = studios.length
  const provisioned = studios.filter((s) => s.provisionedByAdmin).length
  const organic = total - provisioned

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
      <MetricCard label="Class Studios" value={total} hint="Total registered studio rooms" icon={GraduationCap} />
      <MetricCard label="Admin Provisioned" value={provisioned} hint="Created for pilot instructors" icon={Sparkles} />
      <MetricCard label="Organic Studios" value={organic} hint="Created by professors directly" icon={Layers} />
    </div>
  )
}

export default StudioMetricsStrip
