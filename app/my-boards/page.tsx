'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Image as ImageIcon, LayoutDashboard, PanelsTopLeft, Settings, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, EmptyState, Skeleton, StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'
import type { Board } from '@/types'

const navigation = [
  { href: '/dashboard', label: 'Projects', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: '/my-boards', label: 'My boards', icon: <PanelsTopLeft className="h-4 w-4" />, exact: true },
]

const footerNavigation = [
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
]

const actionLink =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-kova border border-kova-ink bg-primary px-4 py-2 text-sm font-semibold text-text-primary shadow-[0_3px_0_rgb(var(--color-ink))] transition-[transform,background-color,box-shadow] hover:bg-primary-light active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export default function MyBoardsPage() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const fetchBoards = useCallback(async () => {
    if (authStatus !== 'authenticated') return
    setLoading(true)
    setFetchError(false)
    try {
      const response = await fetch('/api/my-boards')
      if (response.ok) {
        const data = await response.json()
        setBoards(Array.isArray(data.boards) ? data.boards : [])
      } else if (response.status === 401) {
        router.push('/sign-in?redirect=/my-boards')
      } else {
        setFetchError(true)
      }
    } catch (error) {
      console.error('Error fetching boards:', error)
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [authStatus, router])

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/sign-in?redirect=/my-boards')
      return
    }
    if (authStatus === 'authenticated') {
      const fetchTimer = window.setTimeout(() => void fetchBoards(), 0)
      return () => window.clearTimeout(fetchTimer)
    }
  }, [authStatus, fetchBoards, router])

  return (
    <AppShell
      navigation={navigation}
      footerNavigation={footerNavigation}
      currentPath="/my-boards"
      contentClassName="bg-background"
    >
      <PageHeader
        eyebrow="Library"
        title="My boards"
        description="All of your uploaded boards, ready to review or share."
        actions={
          <Link href="/upload" className={actionLink}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload new board
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div role="status" aria-label="Loading your boards" className="space-y-5">
            <span className="sr-only">Loading your boards</span>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Card key={item} className="overflow-hidden p-0">
                  <Skeleton className="aspect-[16/10] rounded-none" />
                  <div className="space-y-3 p-5">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : fetchError ? (
          <StatusState
            status="error"
            title="Could not load your boards"
            description="Check your connection and try again."
            action={<Button type="button" onClick={() => void fetchBoards()}>Try again</Button>}
            className="mx-auto max-w-lg"
          />
        ) : boards.length === 0 ? (
          <EmptyState
            title="No boards yet"
            description="Upload your first board to start building your library."
            icon={<ImageIcon className="h-8 w-8" aria-hidden="true" />}
            action={<Link href="/upload" className={actionLink}>Upload your first board</Link>}
          />
        ) : (
          <section aria-labelledby="board-library-title">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="board-library-title" className="text-xl font-bold text-text-primary">Board library</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {boards.length} board{boards.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {boards.map((board) => (
                <Link
                  key={board.id}
                  href={`/board/${board.id}`}
                  className="group rounded-kova-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Card className="h-full overflow-hidden p-0 transition-[transform,box-shadow] group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-raised)]">
                    <div className="relative aspect-[16/10] overflow-hidden bg-background-lighter">
                      {board.thumbnailUrl ? (
                        // Board images can be hosted by Supabase; native images avoid a brittle host allowlist.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={board.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-200 motion-reduce:transition-none group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-text-muted" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="break-words text-lg font-bold text-text-primary">{board.title}</h3>
                      <p className="mt-1 break-words text-sm text-text-secondary">{board.studentName}</p>
                      {board.tags && board.tags.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2" aria-label="Board tags">
                          {board.tags.slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}
                          {board.tags.length > 3 && <Badge>+{board.tags.length - 3}</Badge>}
                        </div>
                      )}
                      <p className="mt-4 flex items-center gap-2 font-mono text-xs text-text-muted">
                        <CalendarDays className="h-4 w-4" aria-hidden="true" />
                        Uploaded {new Date(board.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}
