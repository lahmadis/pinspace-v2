'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '@/lib/toast'
import type { Comment } from '@/types'

type UseBoardCommentsOptions = {
  boardId?: string
  refreshKey?: number
  postErrorMessage?: string
}

export function useBoardComments({
  boardId,
  refreshKey = 0,
  postErrorMessage = 'Failed to post comment. Please try again.',
}: UseBoardCommentsOptions) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const requestIdRef = useRef(0)

  const fetchComments = useCallback(async () => {
    if (!boardId) return
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/boards/${boardId}/comments`)
      if (!response.ok) throw new Error('Failed to fetch comments')
      const data = await response.json()
      if (requestId === requestIdRef.current) {
        setComments(Array.isArray(data.comments) ? data.comments : [])
      }
    } catch {
      if (requestId === requestIdRef.current) setError('Failed to load comments')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [boardId])

  useEffect(() => {
    if (!boardId) return
    // Opening a board or receiving its realtime refresh key intentionally starts a remote sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchComments()
  }, [boardId, fetchComments, refreshKey])

  const postComment = useCallback(async (authorName: string) => {
    const content = newComment.trim()
    if (!boardId || !content || posting) return
    setPosting(true)
    try {
      const response = await fetch(`/api/boards/${boardId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, authorName }),
      })
      if (!response.ok) throw new Error('Failed to post comment')
      const data = await response.json()
      setComments((current) => [...current, data.comment])
      setNewComment('')
      textareaRef.current?.focus()
    } catch {
      toast.error(postErrorMessage)
    } finally {
      setPosting(false)
    }
  }, [boardId, newComment, postErrorMessage, posting])

  return {
    comments,
    loading,
    error,
    newComment,
    posting,
    textareaRef,
    setNewComment,
    fetchComments,
    postComment,
    resetDraft: () => setNewComment(''),
  }
}
