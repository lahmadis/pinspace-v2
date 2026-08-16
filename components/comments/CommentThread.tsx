'use client'

import type { Ref } from 'react'

import {
  Avatar,
  Button,
  ButtonLink,
  EmptyState,
  StatusState,
  Textarea,
} from '@/components/ui'
import type { Comment } from '@/types'

export function formatCommentTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const elapsed = Date.now() - date.getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(elapsed / 3_600_000)
  const days = Math.floor(elapsed / 86_400_000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type CommentListProps = {
  comments: Comment[]
  loading: boolean
  error: string
  onRetry: () => void
  emptyDescription?: string
}

export function CommentList({
  comments,
  loading,
  error,
  onRetry,
  emptyDescription = 'Start the conversation below.',
}: CommentListProps) {
  if (loading) return <StatusState status="loading" title="Loading comments" />
  if (error) {
    return (
      <StatusState
        status="error"
        title={error}
        action={<Button type="button" size="sm" onClick={onRetry}>Try again</Button>}
      />
    )
  }
  if (comments.length === 0) {
    return <EmptyState title="No comments yet" description={emptyDescription} />
  }

  return comments.map((comment) => (
    <article key={comment.id} className="flex gap-3 rounded-pinspace border border-border bg-background-lighter p-3 motion-reduce:transition-none">
      <Avatar name={comment.authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-text-primary">{comment.authorName}</span>
          <time dateTime={comment.createdAt} className="whitespace-nowrap text-xs text-text-secondary">
            {formatCommentTimestamp(comment.createdAt)}
          </time>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">{comment.content}</p>
      </div>
    </article>
  ))
}

type CommentComposerProps = {
  id: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  posting: boolean
  textareaRef: Ref<HTMLTextAreaElement>
}

export function CommentComposer({
  id,
  value,
  onChange,
  onSubmit,
  posting,
  textareaRef,
}: CommentComposerProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-text-primary">Add a comment</label>
      <Textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            onSubmit()
          }
        }}
        placeholder="Share feedback…"
        rows={3}
        maxLength={2000}
        disabled={posting}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-secondary" aria-live="polite">
          {value.length > 0 ? `${value.length} / 2000 characters` : 'Ctrl or Command + Enter to post'}
        </p>
        <Button type="button" onClick={onSubmit} disabled={!value.trim() || posting} loading={posting}>
          Post comment
        </Button>
      </div>
    </div>
  )
}

export function SignedOutCommentPrompt() {
  return (
    <div className="py-4 text-center">
      <p className="mb-3 text-sm text-text-secondary">Sign in to leave a comment.</p>
      <ButtonLink href="/sign-in">Sign in</ButtonLink>
    </div>
  )
}
