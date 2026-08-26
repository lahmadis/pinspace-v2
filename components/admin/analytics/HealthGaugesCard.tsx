'use client'

import { Activity, CheckCircle2, ShieldCheck, Users } from 'lucide-react'
import { Card } from '@/components/ui'

export interface HealthGaugesCardProps {
  totalUsers?: number
  profileCount?: number
  totalSignups?: number
  activeSignups?: number
  totalStudios?: number
  memberStudios?: number
  loading?: boolean
}

function GaugeItem({
  label,
  value,
  percentage,
  target = 85,
  icon: Icon,
}: {
  label: string
  value: string
  percentage: number
  target?: number
  icon: any
}) {
  const strokeDashoffset = 188 - (188 * Math.min(100, Math.max(0, percentage))) / 100
  const isOptimal = percentage >= target

  return (
    <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-background-lighter/50 border border-border/60 text-center">
      {/* SVG Radial Gauge */}
      <div className="relative flex items-center justify-center mb-2">
        <svg viewBox="0 0 70 70" className="w-20 h-20 transform -rotate-90">
          <circle cx="35" cy="35" r="30" stroke="var(--color-border-light)" strokeWidth="6" fill="none" />
          <circle
            cx="35"
            cy="35"
            r="30"
            stroke={isOptimal ? '#009688' : '#F59E0B'}
            strokeWidth="6"
            strokeDasharray="188"
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-extrabold text-text-primary tabular-nums">{percentage}%</span>
        </div>
      </div>

      <div className="flex items-center gap-1 text-xs font-bold text-text-primary mb-0.5">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <span>{label}</span>
      </div>
      <p className="text-[11px] text-text-secondary tabular-nums">{value}</p>
    </div>
  )
}

export function HealthGaugesCard({
  totalUsers = 0,
  profileCount = 0,
  totalSignups = 0,
  activeSignups = 0,
  totalStudios = 0,
  memberStudios = 0,
  loading = false,
}: HealthGaugesCardProps) {
  // 100% Dynamic calculated rates
  const verificationRate = totalSignups > 0 ? Math.round((activeSignups / totalSignups) * 100) : 100
  const profileCompletionRate = totalUsers > 0 ? Math.min(100, Math.round((profileCount / totalUsers) * 100)) : 100
  const studioActivityRate = totalStudios > 0 ? Math.round((memberStudios / totalStudios) * 100) : 100

  return (
    <Card className="p-6 mb-8">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <h3 className="text-base font-bold text-text-primary">Platform Health Telemetry</h3>
        </div>
        <p className="text-xs text-text-secondary mt-0.5">
          Real-time dynamic operational thresholds and platform engagement rates
        </p>
      </div>

      {loading ? (
        <div className="h-32 w-full animate-pulse rounded-lg bg-background-lighter" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <GaugeItem
            label="Email Verification"
            value={`${activeSignups} of ${totalSignups} verified`}
            percentage={verificationRate}
            target={80}
            icon={ShieldCheck}
          />
          <GaugeItem
            label="Profile Completion"
            value={`${profileCount} of ${totalUsers} completed`}
            percentage={profileCompletionRate}
            target={75}
            icon={Users}
          />
          <GaugeItem
            label="Studio Engagement"
            value={`${memberStudios} of ${totalStudios} active`}
            percentage={studioActivityRate}
            target={70}
            icon={CheckCircle2}
          />
        </div>
      )}
    </Card>
  )
}

export default HealthGaugesCard
