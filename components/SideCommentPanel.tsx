'use client'

import { useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'

import { Avatar, Button, EmptyState, Sheet, StatusState } from '@/components/ui'
import { supabase } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import type { Board, Comment } from '@/types'

interface SideCommentPanelProps {
  board: Board | null
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
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function SideCommentPanel({ board, onClose }: SideCommentPanelProps) {
  const [user, setUser] = useState<User | null>(null)
  const [profileFullName, setProfileFullName] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const authorName = profileFullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Anonymous'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => setUser(session?.user || null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => setUser(session?.user || null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id) {
      // This reset deliberately follows the external auth session rather than deriving render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileFullName(null)
      return
    }
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
      })
      .catch(() => setProfileFullName(null))
  }, [user?.id])

  const fetchComments = async () => {
    if (!board) return
    await Promise.resolve()
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/boards/${board.id}/comments`)
      if (!response.ok) throw new Error('Failed to fetch comments')
      const data = await response.json()
      setComments(data.comments || [])
    } catch {
      setError('Failed to load comments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!board) return
    // Opening a board intentionally triggers the existing remote comment sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchComments()
    // The board id is the established refetch key; fetchComments intentionally stays local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id])

  const handlePost = async () => {
    if (!board || !newComment.trim() || posting) return
    setPosting(true)
    try {
      const response = await fetch(`/api/boards/${board.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment.trim(), authorName }),
      })
      if (!response.ok) throw new Error('Failed to post comment')
      const data = await response.json()
      setComments((current) => [...current, data.comment])
      setNewComment('')
      textareaRef.current?.focus()
    } catch {
      toast.error('Failed to post comment. Please try again.')
    } finally {
      setPosting(false)
    }
  }

  if (!board) return null

  return (
    <Sheet
      open
      side="left"
      onOpenChange={(open) => {
        if (!open) {
          setNewComment('')
          onClose()
        }
      }}
      title={board.title || 'Board comments'}
      description={board.studentName || 'Read and add comments for this board.'}
      className="flex max-w-lg flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] motion-reduce:transition-none [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
        {loading && <StatusState status="loading" title="Loading comments" />}
        {error && <StatusState status="error" title={error} action={<Button type="button" size="sm" onClick={() => { void fetchComments() }}>Try again</Button>} />}
        {!loading && !error && comments.length === 0 && <EmptyState title="No comments yet" description="Be the first to share your thoughts." />}
        {!loading && !error && comments.map((comment) => (
          <article key={comment.id} className="flex gap-3 rounded-kova border border-border bg-background-lighter p-3 motion-reduce:transition-none">
            <Avatar name={comment.authorName} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-text-primary">{comment.authorName}</span>
                <span className="whitespace-nowrap text-xs text-text-secondary">{formatTimestamp(comment.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{comment.content}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 flex-shrink-0 border-t border-border pt-4">
        <label htmlFor="side-board-comment" className="mb-1.5 block text-sm font-semibold text-text-primary">Add a comment</label>
        <textarea
          id="side-board-comment"
          ref={textareaRef}
          value={newComment}
          onChange={(event) => setNewComment(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handlePost()
            }
          }}
          placeholder="Share feedback…"
          className="min-h-24 w-full resize-y rounded-kova border border-border bg-background-light px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-background-lighter"
          rows={3}
          maxLength={2000}
          disabled={posting}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary" aria-live="polite">{newComment.length > 0 ? `${newComment.length} characters` : 'Ctrl or Command + Enter to post'}</p>
          <Button type="button" onClick={() => { void handlePost() }} disabled={!newComment.trim() || posting} loading={posting}>
            {posting ? 'Posting comment…' : 'Post comment'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
