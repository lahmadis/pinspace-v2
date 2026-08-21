'use client'

import type { ReactNode } from 'react'

export function PublicStudioShimmerCanvas({
  title = 'Loading shared studio',
  description = 'Preparing room & 3D artwork assets...',
}: {
  title?: string
  description?: ReactNode
}) {
  return (
    <div role="status" aria-label={title} className="relative flex h-screen w-screen flex-col overflow-hidden bg-pinspace-forest text-white">
      {/* Header bar skeleton */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-24 rounded-pinspace bg-primary/20 animate-pulse" />
          <div className="h-9 w-40 rounded-pinspace border border-white/10 bg-white/5 backdrop-blur-md animate-pulse" />
        </div>
        <div className="h-9 w-32 rounded-pinspace border border-white/10 bg-white/5 backdrop-blur-md animate-pulse" />
      </header>

      {/* 3D Viewport Shimmer Canvas */}
      <main className="relative flex-1 w-full h-full overflow-hidden bg-pinspace-forest">
        {/* Architectural Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgb(255 255 255 / 0.8) 1px, transparent 1px),
              linear-gradient(to bottom, rgb(255 255 255 / 0.8) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />

        {/* Floating Perspective Wall Skeletons */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="relative w-full max-w-5xl h-[70vh] flex items-center justify-center opacity-30">
            {/* Back Wall outline */}
            <div className="absolute w-[60%] h-[50%] rounded-lg border-2 border-dashed border-white/20 bg-white/[0.02] animate-pulse" />
            {/* Left Wall perspective angle */}
            <div className="absolute left-[10%] w-[35%] h-[65%] rounded-lg border-2 border-dashed border-white/15 bg-white/[0.01] skew-y-6 animate-pulse" />
            {/* Right Wall perspective angle */}
            <div className="absolute right-[10%] w-[35%] h-[65%] rounded-lg border-2 border-dashed border-white/15 bg-white/[0.01] -skew-y-6 animate-pulse" />
          </div>
        </div>

        {/* Ambient Pulsing Glowing Orbs */}
        <div className="absolute left-1/3 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl animate-pulse" />
        <div className="absolute right-1/3 bottom-1/3 h-96 w-96 translate-x-1/2 translate-y-1/2 rounded-full bg-accent/10 blur-3xl animate-pulse" />

        {/* Center Badge Card */}
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="relative flex w-full max-w-sm flex-col items-center rounded-2xl border border-white/20 bg-pinspace-forest/90 p-6 sm:p-8 shadow-2xl backdrop-blur-xl text-center">
            {/* Spinning Amber Ring */}
            <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl shadow-inner">
                🏛️
              </div>
            </div>

            <h3 className="text-xl font-bold text-white tracking-tight">{title}</h3>
            <p className="mt-2 text-xs font-medium text-white/70">{description}</p>

            {/* Animated Shimmer Progress Bar */}
            <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-full bg-gradient-to-r from-primary/30 via-primary to-primary/30 animate-shimmer bg-[length:200%_100%]" />
            </div>
          </div>
        </div>

        {/* Floating Bottom Navigator Skeleton */}
        <div className="pointer-events-none fixed bottom-6 right-4 z-40">
          <div className="h-11 w-48 rounded-pinspace border border-white/15 bg-pinspace-forest/90 shadow-lg backdrop-blur-md animate-pulse" />
        </div>
      </main>
    </div>
  )
}
