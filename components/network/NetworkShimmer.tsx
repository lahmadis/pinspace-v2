'use client'

import React from 'react'
import DemoBanner from '@/components/DemoBanner'

export function NetworkShimmerCanvas({
  title = 'Loading Studio Network...',
  description = 'Mapping published studios, academic years, and connections.',
}: {
  title?: string
  description?: string
}) {
  return (
    <div
      role="status"
      aria-label={title}
      className="relative flex min-h-[32rem] sm:min-h-[40rem] w-full items-center justify-center overflow-hidden rounded-pinspace-lg border border-border/40 bg-gradient-to-b from-pinspace-forest via-[#0D3830] to-[#0A2620] p-6 shadow-[var(--shadow-soft)]"
    >
      {/* Background Connecting Lines SVG Skeleton */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-35"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line x1="15%" y1="25%" x2="50%" y2="50%" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />
        <line x1="85%" y1="20%" x2="50%" y2="50%" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />
        <line x1="20%" y1="80%" x2="50%" y2="50%" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />
        <line x1="80%" y1="75%" x2="50%" y2="50%" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />
        <line x1="30%" y1="35%" x2="70%" y2="65%" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      </svg>

      {/* Floating Pulsing Ambient Bubble Node Skeletons */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[12%] top-[20%] h-24 w-24 rounded-full border border-background-light/20 bg-background-light/10 backdrop-blur-sm motion-safe:animate-pulse" />
        <div className="absolute right-[15%] top-[15%] h-32 w-32 rounded-full border border-background-light/20 bg-background-light/10 backdrop-blur-sm motion-safe:animate-pulse" />
        <div className="absolute left-[18%] bottom-[18%] h-28 w-28 rounded-full border border-background-light/20 bg-background-light/10 backdrop-blur-sm motion-safe:animate-pulse" />
        <div className="absolute right-[12%] bottom-[20%] h-20 w-20 rounded-full border border-background-light/20 bg-background-light/10 backdrop-blur-sm motion-safe:animate-pulse" />
        <div className="absolute left-[45%] top-[10%] h-16 w-16 rounded-full border border-background-light/15 bg-background-light/5 backdrop-blur-sm motion-safe:animate-pulse" />
      </div>

      {/* Center High-Contrast Glassmorphic Loading Card */}
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center justify-center rounded-2xl border border-background-light/20 bg-pinspace-forest/90 p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="relative mb-4 flex items-center justify-center">
          <div className="h-12 w-12 rounded-full border-[3px] border-background-light/20 border-t-primary animate-spin" />
          <span className="absolute text-xl select-none" aria-hidden="true">🌐</span>
        </div>

        {/* High-Contrast Visible White/Cream Title & Subtitle */}
        <h3 className="mb-1.5 text-base font-bold tracking-wide text-background-light">
          {title}
        </h3>
        <p className="max-w-xs text-xs font-medium leading-relaxed text-pinspace-cream/80">
          {description}
        </p>

        {/* Shimmer Progress Indicator Bar */}
        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-background-light/10">
          <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-primary via-accent to-pinspace-cream animate-pulse" />
        </div>
      </div>

      {/* Floating Bottom Control Bar Skeleton */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-background-light/15 bg-pinspace-forest/80 px-4 py-2 shadow-lg backdrop-blur-md">
        <div className="h-7 w-20 rounded-full bg-background-light/15 animate-pulse" />
        <div className="h-7 w-24 rounded-full bg-background-light/15 animate-pulse" />
        <div className="h-7 w-8 rounded-full bg-background-light/15 animate-pulse" />
      </div>
    </div>
  )
}

export function ExplorePageShimmer() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-text-primary">
      <DemoBanner />
      <header className="border-b border-border bg-background-light">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-7 w-24 rounded bg-background-lighter animate-pulse" />
              <div className="h-6 w-20 rounded bg-background-lighter animate-pulse" />
            </div>
            <div className="h-4 w-36 rounded bg-background-lighter animate-pulse" />
            <div className="h-10 w-64 sm:w-80 rounded bg-background-lighter animate-pulse" />
            <div className="h-4 w-40 rounded bg-background-lighter animate-pulse" />
          </div>

          <div className="grid w-full gap-3 lg:max-w-2xl sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="h-11 w-full rounded-pinspace bg-background-lighter animate-pulse" />
            <div className="flex gap-2">
              <div className="h-11 w-28 rounded-pinspace bg-background-lighter animate-pulse" />
              <div className="h-11 w-28 rounded-pinspace bg-background-lighter animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6">
        <NetworkShimmerCanvas />
      </main>
    </div>
  )
}
