'use client'

import { useEffect, useState } from 'react'

import { Dialog } from '@/components/ui'
import { CommentList } from '@/components/comments/CommentThread'
import type { Board, Comment } from '@/types'

interface CommentPanelProps {
  boardId: string
  boardTitle: string
  onClose: () => void
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
        <CommentList
          comments={comments}
          loading={loading}
          error={error ?? ''}
          onRetry={() => setRetryCount((count) => count + 1)}
          emptyDescription="There is no feedback on this board yet."
        />
      </div>

      <p className="mt-4 border-t border-border pt-4 text-center text-xs text-text-secondary">
        {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
      </p>
    </Dialog>
  )
}
