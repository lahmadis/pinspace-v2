'use client'

import { Card, Skeleton } from '@/components/ui'

export function MyBoardsShimmer() {
  return (
    <div role="status" aria-label="Loading your boards" className="space-y-6 animate-fade-in">
      <span className="sr-only">Loading your boards…</span>

      {/* Filter and Control Toolbar Shimmer */}
      <div className="flex flex-col gap-4 rounded-pinspace-lg border border-border bg-background-light p-4 sm:flex-row sm:items-center sm:justify-between shadow-[var(--shadow-soft)]">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <Skeleton className="h-10 min-w-[220px] flex-1 rounded-pinspace" />
          <Skeleton className="h-10 w-44 rounded-pinspace" />
          <Skeleton className="h-10 w-40 rounded-pinspace" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Skeleton className="h-10 w-36 rounded-pinspace" />
          <Skeleton className="h-10 w-24 rounded-pinspace" />
        </div>
      </div>

      {/* Boards Grid Shimmer */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Card key={item} className="overflow-hidden p-0 border border-border bg-background-card">
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-3/4 rounded" />
                <Skeleton className="h-5 w-16 rounded-pinspace" />
              </div>
              <Skeleton className="h-4 w-1/2 rounded" />
              <div className="flex items-center gap-2 pt-2">
                <Skeleton className="h-6 w-24 rounded-pinspace" />
                <Skeleton className="h-6 w-20 rounded-pinspace" />
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-4 w-16 rounded" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
