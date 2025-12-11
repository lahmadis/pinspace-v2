'use client'

import Link from 'next/link'
import Gallery3D from '@/components/Gallery3D'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

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

export default function GalleryPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="absolute top-4 left-6 z-20 text-text-primary">
        <p className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">Gallery Mode</p>
        <h1 className="text-4xl md:text-5xl font-bold mt-2">3D Gallery</h1>
        <p className="text-text-secondary mt-2 text-sm md:text-base">
          Your avatar selections are saved for this session.
        </p>
      </div>
      <div className="absolute top-6 right-6 z-20">
        <Link href="/" className="text-primary hover:text-primary-light font-semibold">
          ← Back home
        </Link>
      </div>

      <Suspense fallback={<main className="w-full h-screen" />}>
        <GalleryContent />
      </Suspense>
    </div>
  )
}

