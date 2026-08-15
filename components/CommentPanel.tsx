'use client'

import { useEffect, useState } from 'react'

import { Avatar, Button, Dialog, EmptyState, StatusState } from '@/components/ui'
import type { Board, Comment } from '@/types'

interface CommentPanelProps {
  boardId: string
  boardTitle: string
  onClose: () => void
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

export default function CommentPanel({ boardId, boardTitle, onClose }: CommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const isDemo = window.location.search.includes('demo=true')
        const commentsUrl = isDemo ? `/api/boards/${boardId}/comments?demo=true` : `/api/boards/${boardId}/comments`
        const commentsResponse = await fetch(commentsUrl)
        if (!commentsResponse.ok) throw new Error('Failed to fetch comments')
        const commentsData = await commentsResponse.json()
        if (cancelled) return
        setComments(commentsData.comments || [])

        const boardResponse = await fetch(`/api/boards?studioId=${boardId.split('-')[0] || 'default'}`)
        if (!boardResponse.ok || cancelled) return
        const boardsData = await boardResponse.json()
        const foundBoard = boardsData.boards?.find((candidate: Board) => candidate.id === boardId)
        if (foundBoard) setBoard(foundBoard)
      } catch {
        if (!cancelled) setError('Failed to load comments')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchData()
    return () => { cancelled = true }
  }, [boardId, retryCount])

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title="Comments"
      description={boardTitle}
      className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] max-w-2xl motion-reduce:transition-none [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
      {board?.thumbnailUrl && (
        <div className="mb-4 flex items-center gap-3 rounded-pinspace border border-border bg-background-lighter p-3">
          {/* Supabase-hosted thumbnail; native image preserves the existing unrestricted storage host behavior. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={board.thumbnailUrl} alt="" className="h-16 w-16 rounded-pinspace object-cover" />
          <p className="min-w-0 truncate font-semibold text-text-primary">{boardTitle}</p>
        </div>
      )}

      <div className="space-y-3" aria-live="polite">
        {loading && <StatusState status="loading" title="Loading comments" />}
        {error && <StatusState status="error" title={error} action={<Button type="button" size="sm" onClick={() => setRetryCount((count) => count + 1)}>Try again</Button>} />}
        {!loading && !error && comments.length === 0 && <EmptyState title="No comments yet" description="There is no feedback on this board yet." />}
        {!loading && !error && comments.map((comment) => (
          <article key={comment.id} className="flex gap-3 rounded-pinspace border border-border bg-background-lighter p-4 motion-reduce:transition-none">
            <Avatar name={comment.authorName} />
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-text-primary">{comment.authorName}</span>
                <span className="text-xs text-text-secondary">{formatTimestamp(comment.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-text-primary">{comment.content}</p>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 border-t border-border pt-4 text-center text-xs text-text-secondary">
        {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
      </p>
    </Dialog>
  )
}
