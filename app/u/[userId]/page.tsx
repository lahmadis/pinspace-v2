'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ExternalLink, Images } from 'lucide-react'
import { Button, Dialog, EmptyState, Select, StatusState } from '@/components/ui'

type PortfolioBoard = {
  id: string
  title: string
  thumbnailUrl: string
  fullImageUrl: string
  uploadedAt: string
  tags: string[]
  studioId: string
  studioName: string
  networkMetadata?: { year?: string; department?: string }
  academicYear?: string
  aspectRatio?: number
}

type Profile = {
  full_name: string | null
  major: string | null
  year: string | null
  role: string | null
}

type LoadState = 'loading' | 'ok' | 'error'

export default function PortfolioPage() {
  const params = useParams()
  const userId = params.userId as string
  const [boards, setBoards] = useState<PortfolioBoard[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedBoard, setSelectedBoard] = useState<PortfolioBoard | null>(null)
  const [filterStudio, setFilterStudio] = useState('all')

  const loadProfile = useCallback(async () => {
    await Promise.resolve()
    setLoadState('loading')
    try {
      const response = await fetch(`/api/users/${userId}/boards`)
      if (!response.ok) throw new Error('Portfolio request failed')
      const data = await response.json()
      setBoards(data.boards || [])
      setProfile(data.profile || null)
      setOwnerName(data.ownerName || null)
      setLoadState('ok')
    } catch (error) {
      console.error(error)
      setLoadState('error')
    }
  }, [userId])

  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProfile() }, [loadProfile])

  if (loadState === 'loading') {
    return <main className="flex min-h-screen items-center justify-center bg-background px-4"><StatusState status="loading" title="Loading portfolio" description="Gathering published boards." /></main>
  }

  if (loadState === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <StatusState status="error" title="Could not load this portfolio" description="The profile may be unavailable. Try again in a moment." action={<Button type="button" onClick={() => void loadProfile()}>Try again</Button>} className="w-full max-w-lg" />
      </main>
    )
  }

  const displayName = profile?.full_name || ownerName || 'Student'
  const uniqueStudios = Array.from(new Map(boards.map((board) => [board.studioId, board.studioName])).entries())
  const filtered = filterStudio === 'all' ? boards : boards.filter((board) => board.studioId === filterStudio)

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-text-primary">
      <header className="sticky top-0 z-20 border-b border-border bg-background-light/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/explore" className="inline-flex min-h-11 items-center rounded-pinspace px-2 text-sm font-semibold text-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">← Explore</Link>
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-text-secondary">Public portfolio</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-10 max-w-3xl">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-primary text-2xl font-bold text-pinspace-ink" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Published work</p>
          <h1 className="mt-2 break-words text-3xl font-black tracking-tight sm:text-5xl">{displayName}</h1>
          <p className="mt-3 break-words text-sm text-text-secondary">
            {[profile?.year, profile?.major, `${boards.length} ${boards.length === 1 ? 'board' : 'boards'}`].filter(Boolean).join(' · ')}
          </p>
        </header>

        {boards.length === 0 ? (
          <EmptyState title="No public boards yet" description="Boards from published studios will appear here." icon={<Images className="h-8 w-8" aria-hidden="true" />} />
        ) : (
          <>
            {uniqueStudios.length > 1 && (
              <div className="mb-8 max-w-sm">
                <label htmlFor="portfolio-studio-filter" className="mb-2 block text-sm font-semibold">Filter by studio</label>
                <Select id="portfolio-studio-filter" value={filterStudio} onChange={(event) => setFilterStudio(event.target.value)}>
                  <option value="all">All studios</option>
                  {uniqueStudios.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </Select>
              </div>
            )}

            {filtered.length === 0 ? (
              <EmptyState title="No boards match this filter" description="Choose another studio to continue browsing." />
            ) : (
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((board) => (
                  <li key={board.id} className="min-w-0">
                    <button
                      type="button"
                      aria-label={`Open ${board.title}`}
                      onClick={() => setSelectedBoard(board)}
                      className="group block w-full overflow-hidden rounded-pinspace-lg border border-border bg-background-light text-left shadow-[var(--shadow-soft)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transform-none"
                    >
                      <span className="relative block w-full overflow-hidden bg-background-lighter">
                        <Image src={board.thumbnailUrl} alt="" width={600} height={board.aspectRatio ? Math.round(600 / board.aspectRatio) : 400} className="h-auto w-full object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.02]" unoptimized />
                      </span>
                      <span className="block p-4">
                        <span className="block break-words text-sm font-bold">{board.title}</span>
                        <span className="mt-1 block break-words text-xs text-text-secondary">{board.studioName}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <Dialog
        open={Boolean(selectedBoard)}
        onOpenChange={(open) => { if (!open) setSelectedBoard(null) }}
        title={selectedBoard?.title ?? 'Board preview'}
        description={selectedBoard ? [selectedBoard.studioName, selectedBoard.networkMetadata?.year, selectedBoard.academicYear].filter(Boolean).join(' · ') : undefined}
        className="max-w-4xl"
      >
        {selectedBoard && (
          <>
            <Image src={selectedBoard.fullImageUrl} alt={selectedBoard.title} width={1200} height={800} className="max-h-[65vh] h-auto w-full rounded-pinspace object-contain" unoptimized />
            <Link href={`/studio/${selectedBoard.studioId}/view`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-pinspace border border-pinspace-ink bg-primary px-4 py-2 text-sm font-semibold text-pinspace-ink shadow-[0_3px_0_rgb(var(--color-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              View studio <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        )}
      </Dialog>
    </div>
  )
}
