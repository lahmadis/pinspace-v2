'use client'

import { useState } from 'react'
import { Card, SegmentedControl } from '@/components/ui'

export interface AcquisitionBarChartProps {
  byHowHeard?: Record<string, number>
  byAgeRange?: Record<string, number>
  total?: number
  loading?: boolean
}

export function AcquisitionBarChart({
  byHowHeard = {},
  byAgeRange = {},
  total = 0,
  loading = false,
}: AcquisitionBarChartProps) {
  const [tab, setTab] = useState<'source' | 'age'>('source')

  const dataSource = tab === 'source' ? byHowHeard : byAgeRange
  const entries = Object.entries(dataSource)
    .map(([label, count]) => ({
      label,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const maxCount = Math.max(1, ...entries.map((e) => e.count))

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-text-primary">
            {tab === 'source' ? 'Acquisition Source' : 'By Age Range'}
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">
            {tab === 'source' ? 'How users discovered PinSpace' : 'Demographic age bracket breakdown'}
          </p>
        </div>

        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as 'source' | 'age')}
          options={[
            { value: 'source', label: 'Acquisition Source' },
            { value: 'age', label: 'Age Bracket' },
          ]}
        />
      </div>

      {loading ? (
        <div className="h-44 w-full animate-pulse rounded-lg bg-background-lighter" />
      ) : entries.length === 0 ? (
        <p className="text-xs text-text-dim italic py-6 text-center">No data recorded yet for this metric.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((item) => {
            const barWidth = Math.max(8, Math.round((item.count / maxCount) * 100))
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text-primary truncate max-w-[200px]" title={item.label}>
                    {item.label}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-text-primary tabular-nums">{item.count}</span>
                    <span className="text-[11px] text-text-dim tabular-nums">({item.percentage}%)</span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-background-lighter border border-border-light">
                  <div
                    className="h-full rounded-full bg-accent/80 transition-all duration-300"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export default AcquisitionBarChart
