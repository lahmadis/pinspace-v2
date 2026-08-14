'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { Button, Card, EmptyState, Input, StatusState } from '@/components/ui'
import { toast } from '@/lib/toast'
import type { Board, Comment } from '@/types'

export default function BoardDetailPage() {
  const params = useParams()
  const router = useRouter()
  const boardId = params.id as string
  const [board, setBoard] = useState<Board | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [boardError, setBoardError] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [commentForm, setCommentForm] = useState({ authorName: '', authorEmail: '', content: '' })
  const [submitting, setSubmitting] = useState(false)
  const [commentStatus, setCommentStatus] = useState('')
  const submittingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const fetchBoard = async () => {
      try {
        const response = await fetch(`/api/boards/${boardId}`)
        if (cancelled) return
        if (!response.ok) {
          setBoardError(true)
          return
        }
        const data = await response.json()
        setBoard(data.board)
      } catch (error) {
        console.error('Error fetching board:', error)
        if (!cancelled) setBoardError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const fetchComments = async () => {
      try {
        const response = await fetch(`/api/comments?boardId=${boardId}`)
        if (cancelled) return
        if (!response.ok) {
          setCommentsError('Comments could not be loaded.')
          return
        }
        const data = await response.json()
        setComments(data.comments)
      } catch (error) {
        console.error('Error fetching comments:', error)
        if (!cancelled) setCommentsError('Comments could not be loaded.')
      } finally {
        if (!cancelled) setCommentsLoading(false)
      }
    }

    void fetchBoard()
    void fetchComments()
    return () => { cancelled = true }
  }, [boardId])

  const handleSubmitComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setCommentStatus('')

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, ...commentForm }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setCommentStatus('Comment could not be posted.')
        return
      }
      setComments((current) => [...current, data.comment])
      setCommentForm({ authorName: '', authorEmail: '', content: '' })
      setShowCommentForm(false)
      toast.success('Comment added!')
    } catch {
      setCommentStatus('Comment could not be posted.')
      toast.error('Failed to add comment')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <StatusState status="loading" title="Loading board" description="Preparing the board and its feedback." className="w-full max-w-md" />
      </main>
    )
  }

  if (boardError || !board) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <StatusState
          status="error"
          title="Board unavailable"
          description="This board may no longer be available, or you may not have permission to view it."
          action={<Button type="button" variant="ghost" onClick={() => router.back()}>Go back</Button>}
          className="w-full max-w-md"
        />
      </main>
    )
  }

  const downloadBoard = () => {
    if (!board.fullImageUrl) return
    const link = document.createElement('a')
    link.href = board.fullImageUrl
    link.download = `${board.studentName}-${board.title}.jpg`
    link.click()
  }

  const copyBoardLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard!')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  return (
    <main className="min-h-screen bg-background pb-[max(3rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-border bg-background-light/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => router.back()} className="min-h-11 shrink-0 px-3" aria-label="Back">
              <span aria-hidden="true">←</span>
            </Button>
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">Board review</p>
              <h1 className="truncate text-2xl font-black text-text-primary">{board.title}</h1>
              <p className="truncate text-sm text-text-secondary">{board.studentName}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <Button type="button" variant="ghost" onClick={downloadBoard} className="min-h-11 px-3" aria-label="Download board">Download</Button>
            <Button type="button" variant="ghost" onClick={() => { void copyBoardLink() }} className="min-h-11 px-3" aria-label="Copy board link">Share</Button>
            <Button type="button" onClick={() => { setShowCommentForm((visible) => !visible); setCommentStatus('') }} className="min-h-11 px-3" aria-label="Add comment">Comment</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:gap-8 lg:py-10">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden p-0">
            <div className="relative aspect-[16/10] bg-background-lighter">
              {board.fullImageUrl && board.fullImageUrl.startsWith('/uploads/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={board.fullImageUrl} alt={board.title} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center">
                  <div>
                    <p className="text-lg font-semibold text-text-primary">{board.title}</p>
                    <p className="mt-2 text-sm text-text-secondary">Board preview</p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-text-primary">Comments <span className="font-mono text-sm text-text-muted">{comments.length}</span></h2>
            </div>

            {showCommentForm && (
              <form aria-label="Add a comment" onSubmit={handleSubmitComment} className="mb-6 space-y-4 rounded-kova border border-border bg-background-lighter p-4" noValidate>
                <div>
                  <label htmlFor="board-comment-name" className="mb-1.5 block text-sm font-semibold text-text-primary">Your name</label>
                  <Input id="board-comment-name" type="text" maxLength={80} autoComplete="name" value={commentForm.authorName} onChange={(event) => setCommentForm({ ...commentForm, authorName: event.target.value })} required />
                </div>
                <div>
                  <label htmlFor="board-comment-email" className="mb-1.5 block text-sm font-semibold text-text-primary">Your email</label>
                  <Input id="board-comment-email" type="email" maxLength={254} autoComplete="email" value={commentForm.authorEmail} onChange={(event) => setCommentForm({ ...commentForm, authorEmail: event.target.value })} />
                  <p className="mt-1 text-xs text-text-muted">Optional</p>
                </div>
                <div>
                  <label htmlFor="board-comment-content" className="mb-1.5 block text-sm font-semibold text-text-primary">Comment</label>
                  <textarea
                    id="board-comment-content"
                    maxLength={2000}
                    rows={4}
                    value={commentForm.content}
                    onChange={(event) => setCommentForm({ ...commentForm, content: event.target.value })}
                    required
                    className="w-full resize-y rounded-kova border border-border bg-background-light px-3.5 py-2 text-text-primary shadow-sm placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  />
                  <p className="mt-1 text-right font-mono text-xs text-text-muted">{commentForm.content.length}/2000</p>
                </div>
                {commentStatus && <StatusState status="error" title={commentStatus} className="p-3 text-sm" />}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" onClick={() => { setShowCommentForm(false); setCommentStatus('') }}>Cancel</Button>
                  <Button type="submit" loading={submitting} disabled={!commentForm.authorName.trim() || !commentForm.content.trim()}>{submitting ? 'Posting comment' : 'Post comment'}</Button>
                </div>
              </form>
            )}

            {commentsLoading ? (
              <StatusState status="loading" title="Loading comments" description="Preparing the feedback on this board." />
            ) : commentsError ? (
              <StatusState status="error" title={commentsError} />
            ) : comments.length === 0 ? (
              <EmptyState title="No comments yet" description="Start the conversation with constructive feedback." className="min-h-40" />
            ) : (
              <ol className="space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="rounded-kova border border-border bg-background-lighter p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-text-primary">{comment.authorName}</p>
                      <time className="font-mono text-xs text-text-muted" dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-primary">{comment.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="space-y-6" aria-label="Board details">
          <Card>
            <h2 className="text-lg font-bold text-text-primary">Student</h2>
            <p className="mt-3 font-semibold text-text-primary">{board.studentName}</p>
            {board.studentEmail && <p className="mt-1 break-all text-sm text-text-secondary">{board.studentEmail}</p>}
            <p className="mt-3 text-sm text-text-muted">Uploaded {new Date(board.uploadedAt).toLocaleDateString()}</p>
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-text-primary">Project details</h2>
            {board.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-text-secondary">{board.description}</p>}
            {board.tags && board.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2" aria-label="Tags">
                {board.tags.map((tag) => <span key={tag} className="rounded-full bg-primary-muted px-3 py-1 text-xs font-semibold text-kova-ink">{tag}</span>)}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </main>
  )
}
