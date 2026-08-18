'use client'

import { useState } from 'react'
import { formatCommentTimestamp } from './CommentThread'
import { Textarea } from '@/components/ui'

interface SingleCommentCardProps {
  comment: {
    id: string
    authorId?: string
    authorName: string
    content: string
    createdAt: string
  }
  canManage?: boolean
  onSaveEdit?: (commentId: string, newContent: string) => Promise<void> | void
  onDelete?: (commentId: string) => Promise<void> | void
  isDeleting?: boolean
  isSaving?: boolean
}

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function getAvatarBgColor(name: string): string {
  const colors = [
    'bg-emerald-600',
    'bg-teal-600',
    'bg-cyan-600',
    'bg-indigo-600',
    'bg-blue-600',
    'bg-amber-600',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % colors.length
  return colors[index]
}

export function SingleCommentCard({
  comment,
  canManage = false,
  onSaveEdit,
  onDelete,
  isDeleting = false,
  isSaving = false,
}: SingleCommentCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(comment.content)
  const [pendingDelete, setPendingDelete] = useState(false)

  const handleStartEdit = () => {
    setEditText(comment.content)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditText(comment.content)
  }

  const handleSave = async () => {
    if (!editText.trim() || isSaving) return
    if (onSaveEdit) {
      await onSaveEdit(comment.id, editText.trim())
    }
    setIsEditing(false)
  }

  const handleDeleteConfirm = async () => {
    if (onDelete && !isDeleting) {
      await onDelete(comment.id)
    }
    setPendingDelete(false)
  }

  return (
    <article className="group relative rounded-pinspace-lg border border-border/80 bg-background-light p-3.5 shadow-xs hover:border-primary/30 hover:shadow-sm transition-all duration-200">
      <div className="flex items-start gap-3">
        {/* Avatar with Ring */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full ${getAvatarBgColor(comment.authorName)} text-white font-bold text-xs flex items-center justify-center ring-2 ring-primary/15 shadow-xs select-none`}>
          {getInitials(comment.authorName)}
        </div>

        {/* Comment Content Column */}
        <div className="flex-1 min-w-0">
          {/* Header Row: Author Name, Badge & Relative Timestamp */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-text-primary text-xs truncate">
                {comment.authorName}
              </span>
            </div>
            <time dateTime={comment.createdAt} className="text-[11px] text-text-muted whitespace-nowrap">
              {formatCommentTimestamp(comment.createdAt)}
            </time>
          </div>

          {/* Edit Mode vs Read Mode */}
          {isEditing ? (
            <div className="mt-2 space-y-2">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="text-xs text-text-primary bg-background-lighter border border-border focus:border-primary focus:ring-1 focus:ring-primary rounded-pinspace p-2 w-full"
                placeholder="Edit comment..."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelEdit()
                  else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void handleSave()
                  }
                }}
                autoFocus
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-text-muted">Esc to cancel · Cmd+Enter to save</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    className="px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary rounded hover:bg-background-lighter transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleSave() }}
                    disabled={!editText.trim() || isSaving}
                    className="px-3 py-1 text-xs font-semibold text-text-primary bg-primary hover:bg-primary-light rounded-pinspace transition-colors disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap break-words">
              {comment.content}
            </p>
          )}

          {/* Micro-Actions Bar (shown on hover or active management) */}
          {canManage && !isEditing && (
            <div className="mt-2 flex items-center justify-end gap-2 pt-1 border-t border-border/40 opacity-90 group-hover:opacity-100 transition-opacity">
              {pendingDelete ? (
                <div className="flex items-center gap-1.5 bg-background-lighter px-2 py-0.5 rounded border border-border">
                  <span className="text-[11px] font-medium text-text-secondary">Delete comment?</span>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(false)}
                    className="text-[11px] px-1.5 py-0.5 font-medium text-text-secondary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleDeleteConfirm() }}
                    disabled={isDeleting}
                    className="text-[11px] px-2 py-0.5 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm'}
                  </button>
                </div>
              ) : (
                <>
                  {onSaveEdit && (
                    <button
                      type="button"
                      onClick={handleStartEdit}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-primary-dark hover:bg-primary-muted px-2 py-0.5 rounded transition-colors"
                      title="Edit comment"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
                      </svg>
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(true)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-rose-600 hover:bg-rose-50 px-2 py-0.5 rounded transition-colors"
                      title="Delete comment"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
