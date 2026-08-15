'use client'

export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Gallery3D from '@/components/Gallery3D'
import { DEFAULT_GALLERY_AVATAR_COLOR } from '@/components/GalleryAvatarModal'
import DemoBanner from '@/components/DemoBanner'
import { StatusState } from '@/components/ui'
import { addDemoParam } from '@/lib/demoMode'

function GalleryContent() {
  const searchParams = useSearchParams()
  const avatarColor = searchParams?.get('color') || DEFAULT_GALLERY_AVATAR_COLOR
  return <Gallery3D avatarColor={avatarColor} department={searchParams?.get('department') || null} year={searchParams?.get('year') || null} />
}

function GalleryPageInner() {
  const searchParams = useSearchParams()
  const isDemo = searchParams?.get('demo') === 'true'
  return (
    <div className="relative h-screen min-h-[36rem] w-full overflow-hidden bg-pinspace-forest">
      <DemoBanner />
      <header className="pointer-events-none absolute left-3 top-3 z-30 max-w-[calc(100%-1.5rem)] rounded-pinspace-lg border border-border bg-background-light/95 p-4 text-text-primary shadow-[var(--shadow-raised)] backdrop-blur-md sm:left-6 sm:top-6 sm:p-5">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Immersive discovery</p>
        <h1 className="mt-1 break-words text-3xl font-black sm:text-5xl">3D Gallery</h1>
        <p className="mt-1 max-w-sm text-xs text-text-secondary sm:text-sm">Explore published studios with keyboard, pointer, or touch controls.</p>
        <Link href={addDemoParam('/', isDemo)} className="pointer-events-auto mt-3 inline-flex min-h-11 items-center rounded-pinspace border border-pinspace-ink bg-primary px-4 py-2 text-sm font-semibold text-pinspace-ink shadow-[0_3px_0_rgb(var(--color-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">← Back home</Link>
      </header>
      <main className="h-full w-full" aria-label="Gallery experience">
        <Suspense fallback={<div className="flex h-full items-center justify-center p-4"><StatusState status="loading" title="Loading 3D gallery" /></div>}><GalleryContent /></Suspense>
      </main>
    </div>
  )
}

export default function GalleryPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-pinspace-forest p-4"><StatusState status="loading" title="Loading 3D gallery" /></main>}><GalleryPageInner /></Suspense>
}
