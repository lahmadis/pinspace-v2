'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Comment, Board } from '@/types'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'

interface LightboxModalProps {
  board: Board | null
  allBoards: Board[] // For navigation
  compareBoards?: Board[]
  autoEnterPresentCompare?: boolean
  onClose: () => void
  onNavigate: (direction: 'prev' | 'next') => void
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
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-purple-500',
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-red-500',
    'bg-teal-500',
  ]
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

export default function LightboxModal({ board, allBoards, compareBoards = [], autoEnterPresentCompare = false, onClose, onNavigate }: LightboxModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isPresentMode, setIsPresentMode] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = board !== null
  const [profileFullName, setProfileFullName] = useState<string | null>(null)
  const authorName = profileFullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Anonymous'
  const isDemoMode = searchParams.get('demo') === 'true' || (typeof window !== 'undefined' && window.location.pathname.includes('demo-studio-'))

  useEffect(() => {
    supabase.auth.getSession().then(
      ({ data: { session } }: { data: { session: Session | null } }) => {
        setUser(session?.user || null)
      }
    )

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUser(session?.user || null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id) {
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

  // Current board index for navigation
  const currentIndex = board ? allBoards.findIndex(b => b.id === board.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < allBoards.length - 1
  const compareCount = compareBoards.length
  const isComparePresentMode = isPresentMode && compareBoards.length > 1
  const compareGapPx = compareCount <= 2 ? 24 : compareCount <= 4 ? 16 : 12
  const compareCardMinPx = compareCount <= 2 ? 320 : compareCount <= 4 ? 260 : 220
  const compareCardMaxPx = compareCount <= 2 ? 760 : compareCount <= 4 ? 560 : 420
  const compareCardWidth = `clamp(${compareCardMinPx}px, calc((100vw - 64px - ${(Math.max(compareCount, 1) - 1) * compareGapPx}px) / ${Math.max(compareCount, 1)}), ${compareCardMaxPx}px)`
  const compareJustifyClass = compareCount <= 3 ? 'justify-center' : 'justify-start'

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => setIsVisible(true), 10)
    } else {
      setIsVisible(false)
      setIsPresentMode(false)
      setCommentsOpen(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (autoEnterPresentCompare && compareBoards.length > 1) {
      setIsPresentMode(true)
    }
  }, [isOpen, autoEnterPresentCompare, compareBoards.length])

  useEffect(() => {
    if (!board) {
      setComments([])
      setNewComment('')
      setCommentsOpen(false)
      setEditingCommentId(null)
      setEditingContent('')
      return
    }

    fetchComments()
  }, [board?.id])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPresentMode) {
          if (isComparePresentMode) {
            handleClose()
          } else {
            setIsPresentMode(false)
          }
        } else {
          handleClose()
        }
      } else if (!isComparePresentMode && e.key === 'ArrowLeft' && hasPrev) {
        onNavigate('prev')
      } else if (!isComparePresentMode && e.key === 'ArrowRight' && hasNext) {
        onNavigate('next')
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, hasPrev, hasNext, isPresentMode, isComparePresentMode, onNavigate])

  const fetchComments = async () => {
    if (!board) return

    try {
      setLoading(true)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, { credentials: 'include' })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = data?.error === 'Board not found'
          ? 'Board not found'
          : response.status === 403 || response.status === 401
            ? 'Sign in to view comments'
            : (data?.details || data?.error || 'Failed to load comments')
        setError(message)
        setComments([])
        return
      }

      setComments(data.comments || [])
    } catch (err) {
      console.error('Error fetching comments:', err)
      setError('Failed to load comments')
      setComments([])
    } finally {
      setLoading(false)
    }
  }

  const handlePost = async () => {
    if (!board || !newComment.trim() || posting) return
    if (!user) {
      setError('Sign in to post a comment')
      return
    }

    try {
      setPosting(true)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          authorName: authorName,
        }),
        credentials: 'include',
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = response.status === 401
          ? 'Sign in to post a comment'
          : (data?.details || data?.error || 'Failed to post comment')
        setError(message)
        return
      }

      setComments(prev => [...prev, data.comment])
      setNewComment('')
      textareaRef.current?.focus()
    } catch (err) {
      console.error('Error posting comment:', err)
      setError('Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handlePost()
    }
  }

  const canManageComment = (comment: Comment) => {
    if (!user) return false
    if (comment.authorId && comment.authorId === user.id) return true
    return comment.authorName === authorName
  }

  const handleStartEdit = (comment: Comment) => {
    setEditingCommentId(comment.id)
    setEditingContent(comment.content)
  }

  const handleCancelEdit = () => {
    setEditingCommentId(null)
    setEditingContent('')
  }

  const handleSaveEdit = async (commentId: string) => {
    if (!board || !editingContent.trim() || savingCommentId) return
    try {
      setSavingCommentId(commentId)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, content: editingContent.trim() }),
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.details || data?.error || 'Failed to edit comment')
        return
      }
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, content: data.comment.content } : c)))
      handleCancelEdit()
    } catch (err) {
      console.error('Error editing comment:', err)
      setError('Failed to edit comment')
    } finally {
      setSavingCommentId(null)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!board || deletingCommentId) return
    if (pendingDeleteCommentId !== commentId) {
      setPendingDeleteCommentId(commentId)
      // Auto-clear after 4 seconds if user doesn't confirm
      setTimeout(() => setPendingDeleteCommentId((prev) => prev === commentId ? null : prev), 4000)
      return
    }
    setPendingDeleteCommentId(null)
    try {
      setDeletingCommentId(commentId)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.details || data?.error || 'Failed to delete comment')
        return
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      if (editingCommentId === commentId) handleCancelEdit()
    } catch (err) {
      console.error('Error deleting comment:', err)
      setError('Failed to delete comment')
    } finally {
      setDeletingCommentId(null)
    }
  }

  const handleClose = () => {
    setIsVisible(false)
    
    // Check if we should return to gallery
    const returnTo = searchParams.get('returnTo')
    if (returnTo === 'gallery') {
      // Navigate back to gallery after a short delay for animation
      setTimeout(() => {
        // Check if we're in demo mode
        const isDemo = searchParams.get('demo') === 'true' || window.location.pathname.includes('demo-studio-')
        
        // Preserve gallery params from current URL (they should be there from the E key handler)
        const urlParams = new URLSearchParams()
        const department = searchParams.get('department')
        const year = searchParams.get('year')
        const color = searchParams.get('color')
        const appearance = searchParams.get('appearance')
        
        // Also try to get params from referrer as fallback
        if (document.referrer) {
          try {
            const referrerUrl = new URL(document.referrer)
            referrerUrl.searchParams.forEach((value, key) => {
              if (['color', 'department', 'year', 'appearance'].includes(key)) {
                // Only use referrer value if not already in current URL
                if (!urlParams.has(key)) {
                  urlParams.set(key, value)
                }
              }
            })
          } catch {
            // Ignore referrer parsing errors
          }
        }
        
        // Use current URL params if available (they're more reliable)
        if (department) urlParams.set('department', department)
        if (year) urlParams.set('year', year)
        if (color) urlParams.set('color', color)
        if (appearance) urlParams.set('appearance', appearance)
        
        if (isDemo) {
          urlParams.set('demo', 'true')
        }
        
        router.push(`/gallery?${urlParams.toString()}`)
      }, 200)
    } else {
      // Just close the modal normally
      setTimeout(onClose, 200)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  if (!isOpen || !board) return null

  const imageUrl = board.fullImageUrl || board.thumbnailUrl
  const isPDF = imageUrl?.toLowerCase().endsWith('.pdf')

  return (
    <div 
      className={`fixed inset-0 bg-slate-950/85 z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      {/* Top Header Bar (hidden in present mode) */}
      {!isPresentMode && (
      <div className="absolute top-3 left-3 right-3 h-16 rounded-2xl bg-slate-900/75 backdrop-blur-xl border border-slate-700/70 shadow-[0_10px_30px_rgba(2,6,23,0.45)] flex items-center justify-between px-4 sm:px-5 z-20">
        {/* Board Title */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-300/70 mb-0.5">
            Uploaded Board
          </p>
          <h2 className="text-slate-50 font-semibold text-sm sm:text-[15px] truncate">
            {compareBoards.length > 1 ? `Compare selection (${compareBoards.length})` : board.title}
          </h2>
          {board.studentName && (
            <p className="text-[11px] text-slate-300/90 truncate">
              {board.studentName}
            </p>
          )}
        </div>

        {/* Navigation + Close */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Previous */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate('prev')
            }}
            disabled={!hasPrev}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M15 19l-7-7 7-7"></path>
            </svg>
            <span>Previous</span>
          </button>

          {/* Next */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate('next')
            }}
            disabled={!hasNext}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <span>Next</span>
            <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M9 5l7 7-7 7"></path>
            </svg>
          </button>

          {/* Compact arrow-only buttons on small screens */}
          <div className="flex sm:hidden items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigate('prev')
              }}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous"
            >
              <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M15 19l-7-7 7-7"></path>
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigate('next')
              }}
              disabled={!hasNext}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next"
            >
              <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 5l7 7-7 7"></path>
              </svg>
            </button>
          </div>

          {/* Present - full screen board only */}
          {compareBoards.length <= 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsPresentMode(true)
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
              title="Present (board fills screen)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2M20 8V6a2 2 0 00-2-2h-2M20 16v2a2 2 0 002 2h-2M14 6v12" />
              </svg>
              <span>Present</span>
            </button>
          )}

          {/* Comments Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setCommentsOpen(prev => !prev)
            }}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
            title="Toggle comments panel"
          >
            <span>Comments</span>
            {comments.length > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 rounded-full">
                {comments.length}
              </span>
            )}
          </button>

          {/* Close Button */}
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/30 transition-colors"
            aria-label="Close"
          >
            <svg 
              className="w-3.5 h-3.5 text-white" 
              fill="none" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth="2" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      )}

      {/* Present mode: no top bar; prev/next on sides + exit in corner */}
      {isPresentMode && (
        <>
          {/* Exit present - small corner control so it doesn't block the board */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isComparePresentMode) {
                handleClose()
              } else {
                setIsPresentMode(false)
              }
            }}
            className="absolute top-6 right-6 z-20 px-3 py-1.5 rounded-lg text-xs font-medium text-white/80 hover:text-white bg-black/40 hover:bg-black/60 border border-white/20 transition-colors"
          >
            Exit present
          </button>
          {/* Prev/Next in present mode - left/right edges */}
          {!isComparePresentMode && hasPrev && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('prev') }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white/90 hover:text-white border border-white/20 transition-colors"
              aria-label="Previous board"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {!isComparePresentMode && hasNext && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('next') }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white/90 hover:text-white border border-white/20 transition-colors"
              aria-label="Next board"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </>
      )}

      {/* Main Content */}
      <div className={`h-full flex ${isPresentMode ? 'pt-0' : 'pt-20'}`}>
        {/* Left Side - Image/PDF Display (full area in present mode) */}
        <div 
          className={`flex-1 flex items-center justify-center ${isPresentMode ? 'absolute inset-0 p-4' : 'p-8 lg:p-12'}`}
          onClick={handleBackdropClick}
        >
          {isComparePresentMode ? (
            <div className="w-full h-full overflow-x-auto overflow-y-hidden" onClick={(e) => e.stopPropagation()}>
              <div
                className={`flex w-max min-w-full h-full items-stretch ${compareJustifyClass}`}
                style={{ gap: `${compareGapPx}px` }}
              >
                {compareBoards.map((compareBoard) => {
                  const compareImageUrl = compareBoard.fullImageUrl || compareBoard.thumbnailUrl
                  const compareIsPdf = compareImageUrl?.toLowerCase().endsWith('.pdf')
                  return (
                    <div
                      key={compareBoard.id}
                      className="flex-none h-full min-h-0 flex items-center justify-center"
                      style={{ width: compareCardWidth }}
                    >
                      {compareImageUrl ? (
                        compareIsPdf ? (
                          <a
                            href={compareImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
                          >
                            Open PDF
                          </a>
                        ) : (
                          <img
                            src={compareImageUrl}
                            alt={compareBoard.title}
                            className="w-full h-full object-contain"
                            style={{ transform: `rotate(${compareBoard.position?.rotation ?? 0}rad)`, transition: 'transform 0.3s ease' }}
                          />
                        )
                      ) : (
                        <p className="text-white/70 text-sm">No image available</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : imageUrl ? (
            isPDF ? (
              <div 
                className="w-full h-full max-w-4xl bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* PDF Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-b">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-lg">
                      <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="font-medium text-gray-800 text-sm">{board.title}.pdf</span>
                  </div>
                  <a 
                    href={imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm text-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open in new tab
                  </a>
                </div>
                {/* PDF Embed */}
                <div className="flex-1 bg-gray-200">
                  <embed
                    src={`${imageUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                    type="application/pdf"
                    className="w-full h-full"
                    style={{ minHeight: '70vh' }}
                  />
                </div>
              </div>
            ) : (
              <img
                src={imageUrl}
                alt={board.title}
                className={`max-w-full max-h-full object-contain ${isPresentMode ? 'rounded-none shadow-none w-full h-full' : 'rounded-lg shadow-2xl'}`}
                style={{ transform: `rotate(${board.position?.rotation ?? 0}rad)`, transition: 'transform 0.3s ease' }}
                onClick={(e) => e.stopPropagation()}
              />
            )
          ) : (
            <div className="text-center text-gray-500">
              <div className="text-6xl mb-4">🖼️</div>
              <p>No image available</p>
            </div>
          )}
        </div>

        {/* Right Side - Comment Panel (hidden in present mode) */}
        {!isPresentMode && commentsOpen ? (
        <div 
          className="w-full lg:w-[340px] xl:w-[380px] bg-white/95 backdrop-blur-md flex flex-col shadow-[0_18px_60px_rgba(15,23,42,0.35)] border-l border-gray-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Panel Header */}
          <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200/80">
            <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
                <span className="text-xs">💬</span>
              </span>
              Comments
              {comments.length > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-medium bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                  {comments.length}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500">
              Share concise feedback to help the work grow.
            </p>
          </div>

          {/* Comments List */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#4444ff]/20 border-t-[#4444ff]"></div>
              </div>
            )}

            {error && (
              <div className="text-center py-12">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {!loading && !error && comments.length === 0 && (
              <div className="text-center py-16">
                <div className="text-6xl mb-3">💭</div>
                <p className="text-gray-500 text-sm font-medium">No comments yet</p>
                <p className="text-gray-400 text-xs mt-1">Be the first to share feedback!</p>
              </div>
            )}

            {!loading && !error && comments.length > 0 && comments.map((comment) => (
              <div 
                key={comment.id}
                className="flex gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-gray-200 hover:bg-white transition-colors"
              >
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full ${getAvatarColor(comment.authorName)} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
                  {getInitials(comment.authorName)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="font-semibold text-gray-900 text-xs">
                      {comment.authorName}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">
                        {formatTimestamp(comment.createdAt)}
                      </span>
                      {canManageComment(comment) && (
                        <>
                          <button
                            onClick={() => handleStartEdit(comment)}
                            disabled={deletingCommentId === comment.id || savingCommentId === comment.id}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
                            aria-label="Edit comment"
                            title="Edit"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
                            </svg>
                          </button>
                          {pendingDeleteCommentId === comment.id ? (
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              disabled={deletingCommentId === comment.id || savingCommentId === comment.id}
                              className="inline-flex items-center justify-center rounded-md px-1.5 h-6 text-[10px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                              aria-label="Confirm delete comment"
                              title="Confirm delete"
                            >
                              {deletingCommentId === comment.id ? (
                                <div className="h-3.5 w-3.5 rounded-full border-2 border-red-200 border-t-white animate-spin" />
                              ) : (
                                'Confirm delete'
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              disabled={deletingCommentId === comment.id || savingCommentId === comment.id}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                              aria-label={deletingCommentId === comment.id ? 'Deleting comment' : 'Delete comment'}
                              title="Delete"
                            >
                              {deletingCommentId === comment.id ? (
                                <div className="h-3.5 w-3.5 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" />
                              ) : (
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7v12m6-12v12M10 4h4a1 1 0 011 1v2H9V5a1 1 0 011-1zM5 7h14l-1 13a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7z" />
                                </svg>
                              )}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {editingCommentId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent resize-none bg-white text-gray-800"
                        rows={3}
                        disabled={savingCommentId === comment.id}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveEdit(comment.id)}
                          disabled={!editingContent.trim() || savingCommentId === comment.id}
                          className="px-2.5 py-1.5 bg-[#4f46e5] text-white rounded-md hover:bg-[#4338ca] disabled:opacity-40 text-[11px] font-semibold"
                        >
                          {savingCommentId === comment.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={savingCommentId === comment.id}
                          className="px-2.5 py-1.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-[11px] font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add Comment Form */}
          <div className="flex-shrink-0 border-t border-gray-200 px-4 py-4 bg-gray-50">
            {user ? (
              <div className="space-y-3">
                <textarea
                  ref={textareaRef}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Share your thoughts..."
                  className="w-full px-3 py-2.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent resize-none bg-white text-gray-800 placeholder:text-gray-400 shadow-sm"
                  rows={3}
                  disabled={posting}
                />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-gray-500">
                    {newComment.length > 0 ? (
                      <span className="text-gray-700 font-medium">{newComment.length} characters</span>
                    ) : (
                      'Cmd+Enter to post'
                    )}
                  </p>
                  <button
                    onClick={handlePost}
                    disabled={!newComment.trim() || posting}
                    className="px-4 py-2 bg-[#4f46e5] text-white rounded-lg hover:bg-[#4338ca] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-semibold shadow-sm hover:shadow-md disabled:shadow-none"
                  >
                    {posting ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Posting...
                      </span>
                    ) : (
                      'Post Comment'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-5">
                <div className="mb-3 text-3xl">🔒</div>
                <p className="text-xs text-gray-600 mb-3">Sign in to leave feedback</p>
                <a
                  href="/sign-in"
                  className="inline-block px-5 py-2 bg-[#4f46e5] text-white rounded-lg hover:bg-[#4338ca] transition-all text-xs font-semibold shadow-md hover:shadow-lg"
                >
                  Sign In to Comment
                </a>
              </div>
            )}
          </div>
        </div>
        ) : null}
      </div>

      {/* Navigation Hint (simplified in present mode) */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-slate-900/65 border border-white/10 backdrop-blur-md rounded-full text-white text-xs sm:text-sm">
        {isPresentMode ? (
          <>
            Press <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">ESC</kbd> to exit present
            {!isComparePresentMode && (hasPrev || hasNext) && (
              <>
                <span className="mx-2">•</span>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">←</kbd>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">→</kbd>
                to change board
              </>
            )}
          </>
        ) : (
          <>
            Press <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">ESC</kbd> to close
            {(hasPrev || hasNext) && (
              <>
                <span className="mx-2">•</span>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">←</kbd>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">→</kbd>
                to navigate
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

