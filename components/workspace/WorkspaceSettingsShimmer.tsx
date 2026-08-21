'use client'

import { Card, Skeleton } from '@/components/ui'

export function WorkspaceSettingsShimmer() {
  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8 animate-fade-in">
      <span className="sr-only">Loading workspace settings…</span>
      {/* Header Shimmer */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-36 rounded" />
          <Skeleton className="h-8 w-64 rounded-pinspace sm:h-10 sm:w-80" />
          <Skeleton className="h-4 w-72 rounded" />
        </div>
        <Skeleton className="h-12 w-40 rounded-pinspace bg-primary/20" />
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        {/* Left Column Cards */}
        <div className="min-w-0 space-y-6">
          {/* Invite Students Card Shimmer */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-6 w-40 rounded" />
                <Skeleton className="h-4 w-64 rounded" />
              </div>
              <Skeleton className="h-8 w-20 rounded-pinspace" />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Skeleton className="h-11 flex-1 rounded-pinspace" />
              <Skeleton className="h-11 w-36 rounded-pinspace" />
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-border/40">
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-8 w-32 rounded-pinspace" />
            </div>
          </Card>

          {/* Space Settings Card Shimmer */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-6 w-36 rounded" />
                <Skeleton className="h-4 w-72 rounded" />
              </div>
              <Skeleton className="h-9 w-28 rounded-pinspace" />
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex flex-col gap-3 rounded-pinspace border border-border/60 bg-background-lighter p-4 sm:flex-row sm:items-center sm:justify-between">
                <Skeleton className="h-5 w-44 rounded" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-40 rounded-pinspace" />
                  <Skeleton className="h-9 w-9 rounded-pinspace" />
                  <Skeleton className="h-9 w-9 rounded-pinspace" />
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-pinspace border border-border/60 bg-background-lighter p-4 sm:flex-row sm:items-center sm:justify-between">
                <Skeleton className="h-5 w-36 rounded" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-40 rounded-pinspace" />
                  <Skeleton className="h-9 w-9 rounded-pinspace" />
                  <Skeleton className="h-9 w-9 rounded-pinspace" />
                </div>
              </div>
            </div>
          </Card>

          {/* Members Card Shimmer */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-6 w-28 rounded" />
              <Skeleton className="h-4 w-48 rounded" />
            </div>
            <div className="divide-y divide-border/60">
              {[1, 2, 3].map((item) => (
                <div key={item} className="flex items-center justify-between py-3.5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-32 rounded" />
                      <Skeleton className="h-3 w-20 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
              ))}
            </div>
          </Card>

          {/* Project Lifecycle Card Shimmer */}
          <Card className="p-5 sm:p-6 space-y-3">
            <Skeleton className="h-6 w-36 rounded" />
            <Skeleton className="h-4 w-80 rounded" />
            <Skeleton className="h-10 w-32 rounded-pinspace mt-2" />
          </Card>
        </div>

        {/* Right Sidebar Shimmers */}
        <aside className="min-w-0 space-y-6">
          {/* Export Card Shimmer */}
          <Card className="p-5 sm:p-6 space-y-3">
            <Skeleton className="h-6 w-24 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-10 w-full rounded-pinspace mt-2" />
          </Card>

          {/* Project Info Card Shimmer */}
          <Card className="p-5 sm:p-6 space-y-4">
            <Skeleton className="h-6 w-28 rounded" />
            <div className="space-y-3 pt-1">
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-16 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
              </div>
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-12 rounded" />
                <Skeleton className="h-6 w-16 rounded-pinspace" />
              </div>
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-4 w-40 rounded" />
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
