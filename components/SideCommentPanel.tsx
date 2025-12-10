'use client'

import { useEffect, useState, useRef } from 'react'
import { Comment, Board } from '@/types'

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
  
  // Show full date for older comments
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

export default function SideCommentPanel({ board, onClose }: SideCommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = board !== null

  useEffect(() => {
    if (!board) {
      setComments([])
      setNewComment('')
      return
    }

    fetchComments()
  }, [board?.id])

  useEffect(() => {
    // Close on ESC key
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  const fetchComments = async () => {
    if (!board) return
    
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/boards/${board.id}/comments`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch comments')
      }
      
      const data = await response.json()
      setComments(data.comments || [])
    } catch (err) {
      console.error('Error fetching comments:', err)
      setError('Failed to load comments')
    } finally {
      setLoading(false)
    }
  }

  const handlePost = async () => {
    if (!board || !newComment.trim() || posting) return

    try {
      setPosting(true)
      const response = await fetch(`/api/boards/${board.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: newComment.trim(),
          author: 'Linna' // Hardcoded for now
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to post comment')
      }

      const data = await response.json()
      
      // Add new comment to list
      setComments(prev => [...prev, data.comment])
      setNewComment('')
      
      // Focus textarea
      textareaRef.current?.focus()
      
      console.log('💬 [Comment] Posted successfully:', data.comment)
    } catch (err) {
      console.error('Error posting comment:', err)
      alert('Failed to post comment. Please try again.')
    } finally {
      setPosting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handlePost()
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Side Panel */}
      <div 
        className={`fixed bottom-6 left-6 z-50 w-[400px] h-[500px] bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 flex flex-col transform transition-all duration-300 ${
          isOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-200/50 flex-shrink-0">
          {/* Board Thumbnail */}
          {board?.thumbnailUrl && (
            <div className="w-20 h-20 rounded-lg overflow-hidden shadow-md flex-shrink-0 border-2 border-white">
              <img 
                src={board.thumbnailUrl} 
                alt={board.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Board Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-sm line-clamp-2 leading-tight">
              {board?.title}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {board?.studentName}
            </p>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg 
              className="w-5 h-5 text-gray-500" 
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

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4444ff]/20 border-t-[#4444ff]"></div>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && comments.length === 0 && (
            <div className="text-center py-12">
              <div className="text-5xl mb-3">💭</div>
              <p className="text-gray-500 text-sm font-medium">No comments yet</p>
              <p className="text-gray-400 text-xs mt-1">Be the first to share your thoughts!</p>
            </div>
          )}

          {!loading && !error && comments.length > 0 && comments.map((comment, index) => (
            <div 
              key={comment.id}
              className="flex gap-3 p-3 bg-gray-50/80 rounded-xl hover:bg-gray-100/80 transition-colors"
              style={{
                animation: 'slideUp 0.3s ease-out',
                animationDelay: `${index * 40}ms`,
                animationFillMode: 'backwards'
              }}
            >
              {/* Avatar */}
              <div className={`flex-shrink-0 w-9 h-9 rounded-full ${getAvatarColor(comment.author)} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
                {getInitials(comment.author)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-bold text-gray-900 text-sm">
                    {comment.author}
                  </span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {formatTimestamp(comment.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {comment.text}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Add Comment Form */}
        <div className="border-t border-gray-200/50 p-4 bg-white/95 backdrop-blur-sm rounded-b-2xl flex-shrink-0">
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff]/50 focus:border-[#4444ff] resize-none bg-white"
              rows={3}
              disabled={posting}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {newComment.length > 0 && `${newComment.length} characters`}
              </p>
              <button
                onClick={handlePost}
                disabled={!newComment.trim() || posting}
                className="px-4 py-2 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium shadow-sm hover:shadow-md disabled:shadow-none"
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>

        <style jsx>{`
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    </>
  )
}

