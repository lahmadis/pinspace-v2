'use client'

import { Card } from '@/components/ui'

export interface AcademicYearDonutChartProps {
  byYear?: Record<string, number>
  total?: number
  loading?: boolean
}

const YEAR_COLORS = [
  '#009688', // Teal accent
  '#10B981', // Emerald
  '#3B82F6', // Blue
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#EC4899', // Pink
]

export function AcademicYearDonutChart({ byYear = {}, total = 0, loading = false }: AcademicYearDonutChartProps) {
  const entries = Object.entries(byYear).map(([year, count]) => ({
    year,
    count,
    percentage: total > 0 ? Math.round((count / total) * 100) : 0,
  })).sort((a, b) => b.count - a.count)

  const effectiveTotal = entries.reduce((acc, curr) => acc + curr.count, 0) || total || 1

  // Calculate SVG stroke dashes for donut segments
  let cumulativePercent = 0
  const segments = entries.map((item, idx) => {
    const startPct = cumulativePercent
    cumulativePercent += item.count / effectiveTotal
    return {
      ...item,
      color: YEAR_COLORS[idx % YEAR_COLORS.length],
      dashArray: `${(item.count / effectiveTotal) * 283} 283`,
      dashOffset: -startPct * 283,
    }
  })

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-base font-bold text-text-primary">By Academic Year</h3>
        <p className="text-xs text-text-secondary mt-0.5">Demographic distribution across student year levels</p>
      </div>

      {loading ? (
        <div className="h-44 w-full animate-pulse rounded-lg bg-background-lighter" />
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* SVG Donut */}
          <div className="relative flex items-center justify-center shrink-0">
            <svg viewBox="0 0 100 100" className="w-36 h-36 transform -rotate-90">
              <circle cx="50" cy="50" r="45" stroke="var(--color-border-light)" strokeWidth="10" fill="none" />
              {segments.map((seg, i) => (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r="45"
                  stroke={seg.color}
                  strokeWidth="10"
                  strokeDasharray={seg.dashArray}
                  strokeDashoffset={seg.dashOffset}
                  fill="none"
                  className="transition-all duration-300 hover:stroke-width-12 cursor-pointer"
                >
                  <title>{`${seg.year}: ${seg.count} (${seg.percentage}%)`}</title>
                </circle>
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-extrabold text-text-primary tabular-nums">{effectiveTotal}</span>
              <span className="text-[10px] font-medium text-text-dim uppercase tracking-wider">Students</span>
            </div>
          </div>

          {/* Legend Metric List */}
          <div className="flex-1 w-full space-y-2">
            {segments.length === 0 ? (
              <p className="text-xs text-text-dim italic">No academic year data recorded yet.</p>
            ) : (
              segments.map((item) => (
                <div key={item.year} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="font-semibold text-text-primary">{item.year}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-text-primary tabular-nums">{item.count}</span>
                    <span className="rounded bg-background-lighter px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary tabular-nums border border-border">
                      {item.percentage}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

export default AcademicYearDonutChart
