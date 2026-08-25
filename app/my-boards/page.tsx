'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CalendarDays,
  DoorOpen,
  ExternalLink,
  Grid,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  PanelsTopLeft,
  Search,
  Settings,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

import { MyBoardsShimmer } from '@/components/boards/MyBoardsShimmer'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, EmptyState, Input, Select, StatusState } from '@/components/ui'
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
  'inline-flex min-h-12 items-center justify-center gap-2.5 rounded-pinspace border-transparent bg-primary px-6 py-2.5 text-base font-black text-pinspace-ink shadow-[0_4px_16px_rgba(255,200,0,0.35)] transition-all hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export default function MyBoardsPage() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [selectedSpace, setSelectedSpace] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest')
  const [viewMode, setViewMode] = useState<'grid' | 'grouped'>('grid')

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

  // Extract unique Projects & Spaces for filter dropdowns
  const availableProjects = useMemo(() => {
    const set = new Set<string>()
    boards.forEach((b) => {
      const p = b.workspaceName || (b.workspaceId ? `Project ${b.workspaceId.slice(0, 8)}` : null)
      if (p) set.add(p)
    })
    return Array.from(set).sort()
  }, [boards])

  const availableSpaces = useMemo(() => {
    const set = new Set<string>()
    boards.forEach((b) => {
      if (b.roomName) set.add(b.roomName)
    })
    return Array.from(set).sort()
  }, [boards])

  // Filter & Sort Boards
  const filteredBoards = useMemo(() => {
    return boards
      .filter((board) => {
        // Search filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim()
          const titleMatch = board.title.toLowerCase().includes(q)
          const studentMatch = board.studentName?.toLowerCase().includes(q)
          const tagMatch = board.tags?.some((t) => t.toLowerCase().includes(q))
          if (!titleMatch && !studentMatch && !tagMatch) return false
        }
        // Project filter
        if (selectedProject !== 'all') {
          const pName = board.workspaceName || (board.workspaceId ? `Project ${board.workspaceId.slice(0, 8)}` : null)
          if (pName !== selectedProject && board.workspaceId !== selectedProject) return false
        }
        // Space filter
        if (selectedSpace !== 'all') {
          if (board.roomName !== selectedSpace && board.roomId !== selectedSpace) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        if (sortBy === 'oldest') return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
        if (sortBy === 'title') return a.title.localeCompare(b.title)
        return 0
      })
  }, [boards, searchQuery, selectedProject, selectedSpace, sortBy])

  // Grouped by Space
  const groupedBoards = useMemo(() => {
    const map = new Map<string, Board[]>()
    filteredBoards.forEach((board) => {
      const key = board.roomName ? `Space: ${board.roomName}` : board.workspaceName ? `Project: ${board.workspaceName}` : 'Other Boards'
      const list = map.get(key) || []
      list.push(board)
      map.set(key, list)
    })
    return map
  }, [filteredBoards])

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
        description="All of your uploaded boards, organized by project and space."
        actions={
          <Link href="/upload" className={actionLink}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload new board
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <MyBoardsShimmer />
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
          <section aria-labelledby="board-library-title" className="space-y-6">
            {/* Interactive Search & Filter Toolbar */}
            <div className="flex flex-col gap-4 rounded-pinspace-lg border border-border bg-background-light p-4 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                {/* Search Bar */}
                <div className="relative min-w-[200px] flex-1">
                  <Input
                    type="search"
                    aria-label="Search boards by title or tag"
                    placeholder="Search by title, student, or tag…"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="min-h-10 pl-9"
                  />
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted pointer-events-none" />
                </div>

                {/* Project Filter */}
                {availableProjects.length > 0 && (
                  <Select
                    aria-label="Filter by Project"
                    value={selectedProject}
                    onChange={(event) => setSelectedProject(event.target.value)}
                    className="min-h-10 w-full sm:w-48"
                  >
                    <option value="all">All projects ({boards.length})</option>
                    {availableProjects.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </Select>
                )}

                {/* Space Filter */}
                {availableSpaces.length > 0 && (
                  <Select
                    aria-label="Filter by Space"
                    value={selectedSpace}
                    onChange={(event) => setSelectedSpace(event.target.value)}
                    className="min-h-10 w-full sm:w-44"
                  >
                    <option value="all">All spaces</option>
                    {availableSpaces.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* Sort selector */}
                <Select
                  aria-label="Sort boards"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as 'newest' | 'oldest' | 'title')}
                  className="min-h-10 w-36"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title">Title (A-Z)</option>
                </Select>

                {/* View switcher */}
                <div className="flex items-center gap-1 rounded-pinspace border border-border bg-background p-1" role="group" aria-label="View layout">
                  <Button
                    type="button"
                    variant={viewMode === 'grid' ? 'primary' : 'ghost'}
                    size="sm"
                    className="min-h-8 px-2.5 text-xs"
                    onClick={() => setViewMode('grid')}
                    title="Grid view"
                  >
                    <Grid className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === 'grouped' ? 'primary' : 'ghost'}
                    size="sm"
                    className="min-h-8 px-2.5 text-xs"
                    onClick={() => setViewMode('grouped')}
                    title="Grouped by Space"
                  >
                    <Layers className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Results Counter Bar */}
            <div className="flex items-center justify-between">
              <h2 id="board-library-title" className="text-xl font-bold text-text-primary">
                {filteredBoards.length} board{filteredBoards.length === 1 ? '' : 's'}
                {selectedProject !== 'all' || selectedSpace !== 'all' || searchQuery ? ' (filtered)' : ''}
              </h2>
              {(searchQuery || selectedProject !== 'all' || selectedSpace !== 'all') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSearchQuery(''); setSelectedProject('all'); setSelectedSpace('all'); }}
                  className="text-xs font-semibold text-accent"
                >
                  Reset filters
                </Button>
              )}
            </div>

            {filteredBoards.length === 0 ? (
              <EmptyState
                title="No matching boards found"
                description="Try clearing your search query or filters."
                action={
                  <Button type="button" onClick={() => { setSearchQuery(''); setSelectedProject('all'); setSelectedSpace('all'); }}>
                    Clear all filters
                  </Button>
                }
              />
            ) : viewMode === 'grouped' ? (
              /* Grouped View */
              <div className="space-y-8">
                {Array.from(groupedBoards.entries()).map(([groupTitle, groupBoards]) => (
                  <div key={groupTitle} className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-border/60 pb-2">
                      <DoorOpen className="h-5 w-5 text-accent" />
                      <h3 className="text-lg font-bold text-text-primary">{groupTitle}</h3>
                      <Badge className="ml-2">{groupBoards.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                      {groupBoards.map((board) => (
                        <BoardCard key={board.id} board={board} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Grid View */
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filteredBoards.map((board) => (
                  <BoardCard key={board.id} board={board} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  )
}

function BoardCard({ board }: { board: Board }) {
  const roomPath = board.workspaceId
    ? `/studio/${board.workspaceId}${board.roomId ? `?room=${board.roomId}` : ''}`
    : `/board/${board.id}`

  return (
    <Card className="group relative h-full overflow-hidden p-0 border border-border bg-background-card transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-background-lighter">
        <Link
          href={`/board/${board.id}`}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {board.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={board.thumbnailUrl}
              alt={board.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 motion-reduce:transition-none group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-12 w-12 text-text-muted" aria-hidden="true" />
            </div>
          )}
        </Link>

        {/* Hover Quick Action Overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-pinspace-forest/70 opacity-0 backdrop-blur-xs transition-opacity duration-200 group-hover:opacity-100 p-4 pointer-events-none group-hover:pointer-events-auto">
          <Link
            href={roomPath}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pinspace bg-primary px-4 py-2 text-sm font-black text-pinspace-ink shadow-lg transition-transform hover:scale-105 hover:bg-primary-hover"
          >
            <DoorOpen className="h-4 w-4" />
            Open in 3D Space
          </Link>
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/board/${board.id}`}
            className="break-words text-lg font-bold text-text-primary group-hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {board.title}
          </Link>
        </div>

        <p className="mt-1 break-words text-sm text-text-secondary">{board.studentName}</p>

        {/* Project & Space Badges */}
        <div className="mt-3 flex flex-wrap gap-2">
          {board.workspaceName && (
            <Badge variant="accent" className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              <span className="truncate max-w-[120px]">{board.workspaceName}</span>
            </Badge>
          )}
          {board.roomName && (
            <Badge className="flex items-center gap-1">
              <DoorOpen className="h-3 w-3" />
              <span className="truncate max-w-[120px]">{board.roomName}</span>
            </Badge>
          )}
        </div>

        {board.tags && board.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Board tags">
            {board.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} className="text-xs bg-background-lighter">{tag}</Badge>
            ))}
            {board.tags.length > 3 && <Badge className="text-xs">+{board.tags.length - 3}</Badge>}
          </div>
        )}

        <p className="mt-4 flex items-center justify-between font-mono text-xs text-text-muted pt-3 border-t border-border/40">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {new Date(board.uploadedAt).toLocaleDateString()}
          </span>
          <Link
            href={`/board/${board.id}`}
            className="inline-flex items-center gap-1 text-accent font-semibold group-hover:underline"
          >
            View <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      </div>
    </Card>
  )
}
