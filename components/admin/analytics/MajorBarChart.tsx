'use client'

import { Card } from '@/components/ui'

export interface MajorBarChartProps {
  byMajor?: Record<string, number>
  total?: number
  loading?: boolean
}

export function MajorBarChart({ byMajor = {}, total = 0, loading = false }: MajorBarChartProps) {
  const entries = Object.entries(byMajor)
    .map(([major, count]) => ({
      major,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const maxCount = Math.max(1, ...entries.map((e) => e.count))

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-base font-bold text-text-primary">By Major / Department</h3>
        <p className="text-xs text-text-secondary mt-0.5">Demographic distribution by field of study</p>
      </div>

      {loading ? (
        <div className="h-44 w-full animate-pulse rounded-lg bg-background-lighter" />
      ) : entries.length === 0 ? (
        <p className="text-xs text-text-dim italic py-6 text-center">No major or department data recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((item) => {
            const barWidth = Math.max(8, Math.round((item.count / maxCount) * 100))
            return (
              <div key={item.major} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text-primary truncate max-w-[200px]" title={item.major}>
                    {item.major}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-text-primary tabular-nums">{item.count}</span>
                    <span className="text-[11px] text-text-dim tabular-nums">({item.percentage}%)</span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-background-lighter border border-border-light">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
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

export default MajorBarChart
