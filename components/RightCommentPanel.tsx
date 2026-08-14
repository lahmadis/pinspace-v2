'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { Comment, Board } from '@/types'
import { Avatar, Button, EmptyState, Sheet, StatusState } from '@/components/ui'

interface RightCommentPanelProps {
  board: Board | null
  onClose: () => void
  isArchived?: boolean
  /** Bump from parent on realtime comment events to trigger a refetch. */
  commentNonce?: number
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric'
  })
}

export default function RightCommentPanel({ board, onClose, isArchived = false, commentNonce = 0 }: RightCommentPanelProps) {
  const [user, setUser] = useState<User | null>(null)
  const [profileFullName, setProfileFullName] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = board !== null
  const authorName = profileFullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Anonymous'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user || null)
    })

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
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
      })
      .catch(() => setProfileFullName(null))
  }, [user?.id])

  const fetchComments = useCallback(async (boardId: string) => {
    await Promise.resolve()
    try {
      setLoading(true)
      setError('')
      const response = await fetch(`/api/boards/${boardId}/comments`)
      if (!response.ok) throw new Error('Failed to fetch')
      const data = await response.json()
      setComments(data.comments || [])
    } catch (err) {
      console.error('Error:', err)
      setError('Failed to load comments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!board) return
    // Opening a board or receiving the established realtime nonce intentionally triggers a remote sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchComments(board.id)
  }, [board, commentNonce, fetchComments])

  const handlePost = async () => {
    if (!board || !newComment.trim() || posting) return
    try {
      setPosting(true)
      const response = await fetch(`/api/boards/${board.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment.trim(), authorName: authorName }),
      })
      if (!response.ok) throw new Error('Failed to post')
      const data = await response.json()
      setComments(prev => [...prev, data.comment])
      setNewComment('')
      textareaRef.current?.focus()
    } catch {
      toast.error('Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  if (!isOpen) return null

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          setNewComment('')
          onClose()
        }
      }}
      title={board?.title || 'Board comments'}
      description={board?.studentName || 'Read and add comments for this board.'}
      className="flex max-w-lg flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] motion-reduce:transition-none [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
          {loading && (
            <StatusState status="loading" title="Loading comments" />
          )}

          {error && <StatusState status="error" title={error} action={<Button type="button" size="sm" onClick={() => { void fetchComments(board.id) }}>Try again</Button>} />}

          {!loading && !error && comments.length === 0 && <EmptyState title="No comments yet" description="Start the conversation below." />}

          {!loading && !error && comments.map((comment) => (
            <article key={comment.id} className="flex gap-3 rounded-kova border border-border bg-background-lighter p-3">
              <Avatar name={comment.authorName} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-sm font-semibold text-text-primary">{comment.authorName}</span>
                  <span className="text-xs text-text-secondary">{formatTimestamp(comment.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{comment.content}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-4 flex-shrink-0 border-t border-border pt-4">
          {isArchived ? (
            <StatusState status="info" title="This workspace is archived" description="Existing comments remain available, but new comments are disabled." />
          ) : user ? (
            <>
              <label htmlFor="board-comment" className="mb-1.5 block text-sm font-semibold text-text-primary">Add a comment</label>
              <textarea
                id="board-comment"
                ref={textareaRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handlePost()
                  }
                }}
                placeholder="Share feedback…"
                className="mb-3 min-h-24 w-full resize-y rounded-kova border border-border bg-background-light px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-background-lighter"
                rows={3}
                maxLength={2000}
                disabled={posting}
              />
              <Button
                type="button"
                onClick={() => { void handlePost() }}
                disabled={!newComment.trim() || posting}
                loading={posting}
                className="w-full"
              >
                {posting ? 'Posting comment…' : 'Post comment'}
              </Button>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="mb-3 text-sm text-text-secondary">Sign in to leave a comment.</p>
              <a
                href="/sign-in"
                className="inline-flex min-h-11 items-center justify-center rounded-kova border border-kova-ink bg-primary px-6 py-2 text-sm font-semibold text-kova-ink shadow-[0_3px_0_rgb(var(--color-ink))] hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign in
              </a>
            </div>
          )}
        </div>
    </Sheet>
  )
}
