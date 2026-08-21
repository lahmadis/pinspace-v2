'use client'

import { Card, Skeleton } from '@/components/ui'

export function WorkspaceRoomsShimmer() {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      className="min-h-dvh w-full bg-background text-text-primary animate-fade-in"
    >
      <span className="sr-only">Loading workspace spaces…</span>

      {/* Header Shimmer with Inline Back Button */}
      <header className="border-b border-border bg-background-light py-5">
        <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-pinspace shrink-0" />
              <div className="space-y-1.5 min-w-0">
                <Skeleton className="h-8 w-64 rounded-pinspace sm:w-80" />
                <Skeleton className="h-4 w-36 rounded" />
              </div>
            </div>
            <Skeleton className="h-11 w-40 rounded-pinspace shrink-0" />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[96rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Section Sub-header Shimmer */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <div className="space-y-1">
            <Skeleton className="h-6 w-28 rounded" />
            <Skeleton className="h-4 w-60 rounded" />
          </div>
        </div>

        {/* Spaces Grid Shimmer */}
        <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {/* Dashed Add Space Tile Shimmer */}
          <Card className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-pinspace-lg border-2 border-dashed border-border bg-background-light/50 p-5">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-5 w-24 rounded" />
          </Card>

          {/* Space Cards Shimmer */}
          {[0, 1, 2, 3, 4].map((item) => (
            <Card
              key={item}
              className="relative flex min-h-48 flex-col justify-between overflow-hidden p-5 border border-border bg-background-card"
            >
              <div className="flex items-start justify-between">
                <Skeleton className="h-11 w-11 rounded-pinspace" />
                <Skeleton className="h-9 w-9 rounded-full" />
              </div>
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-3/4 rounded" />
                  <Skeleton className="h-5 w-16 rounded-pinspace" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <Skeleton className="h-4 w-20 rounded" />
                  <Skeleton className="h-4 w-4 rounded" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
