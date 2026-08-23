'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Gallery3D from '@/components/Gallery3D'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import DemoBanner from '@/components/DemoBanner'
import { addDemoParam } from '@/lib/demoMode'

function GalleryContent() {
  const searchParams = useSearchParams()
  const avatarColor = searchParams?.get('color') || '#6366f1'
  const department = searchParams?.get('department') || null
  const year = searchParams?.get('year') || null
  return (
    <main className="w-full h-screen">
      <Gallery3D avatarColor={avatarColor} department={department} year={year} />
    </main>
  )
}

function GalleryPageInner() {
  const searchParams = useSearchParams()
  const isDemo = searchParams?.get('demo') === 'true'

  return (
    <div className="min-h-screen bg-background">
      <DemoBanner />
      <div className="absolute top-4 left-6 z-20 text-text-primary">
        <p className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">Gallery Mode</p>
        <h1 className="text-4xl md:text-5xl font-bold mt-2">3D Gallery</h1>
        <div className="mt-4">
          <Link 
            href={addDemoParam('/', isDemo)} 
            className="bg-white/90 hover:bg-white text-gray-900 px-4 py-2 rounded-lg font-semibold shadow-lg border border-gray-200 transition-colors backdrop-blur-sm inline-block"
          >
            ← Back home
          </Link>
        </div>
      </div>

      <Suspense fallback={<main className="w-full h-screen" />}>
        <GalleryContent />
      </Suspense>
    </div>
  )
}

export default function GalleryPage() {
  return (
    <Suspense fallback={null}>
      <GalleryPageInner />
    </Suspense>
  )
}

