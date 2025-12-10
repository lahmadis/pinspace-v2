'use client'

import { useEffect, useState } from 'react'
import { Comment, Board } from '@/types'

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
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
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

export default function CommentPanel({ boardId, boardTitle, onClose }: CommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Trigger slide-in animation
    setTimeout(() => setIsVisible(true), 10)
  }, [])

  useEffect(() => {
    // Fetch comments and board data when panel opens
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)
        
        // Fetch comments
        const commentsResponse = await fetch(`/api/boards/${boardId}/comments`)
        if (!commentsResponse.ok) {
          throw new Error('Failed to fetch comments')
        }
        const commentsData = await commentsResponse.json()
        setComments(commentsData.comments || [])
        
        // Fetch board data (we need thumbnail)
        const boardResponse = await fetch(`/api/boards?studioId=${boardId.split('-')[0] || 'default'}`)
        if (boardResponse.ok) {
          const boardsData = await boardResponse.json()
          const foundBoard = boardsData.boards?.find((b: Board) => b.id === boardId)
          if (foundBoard) setBoard(foundBoard)
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        setError('Failed to load comments')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [boardId])

  // Close on ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on click outside
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(onClose, 200) // Wait for animation
  }

  return (
    <div 
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      <div 
        className={`bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-white/20 transform transition-all duration-300 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Board Thumbnail */}
        <div className="relative p-6 border-b border-gray-200/50">
          {/* Board Thumbnail Background */}
          {board && board.thumbnailUrl && (
            <div className="absolute inset-0 opacity-10 rounded-t-2xl overflow-hidden">
              <div 
                className="w-full h-full bg-cover bg-center"
                style={{ backgroundImage: `url(${board.thumbnailUrl})` }}
              />
            </div>
          )}
          
          <div className="relative flex items-start justify-between">
            <div className="flex items-start gap-4 flex-1">
              {/* Board Thumbnail */}
              {board && board.thumbnailUrl && (
                <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden shadow-md border-2 border-white/80">
                  <img 
                    src={board.thumbnailUrl} 
                    alt={boardTitle}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-[#1a1a1a] mb-1 flex items-center gap-2">
                  💬 Comments
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold bg-[#4444ff] text-white rounded-full">
                    {comments.length}
                  </span>
                </h2>
                <p className="text-sm text-[#666666] font-medium">
                  {boardTitle}
                </p>
              </div>
            </div>
            
            <button
              onClick={handleClose}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-gray-100/80 hover:bg-red-100 hover:text-red-600 transition-all duration-200 group"
              aria-label="Close"
            >
              <svg 
                className="w-5 h-5 text-gray-600 group-hover:text-red-600 transition-colors" 
                fill="none" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth="2.5" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-b from-transparent to-gray-50/30">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#4444ff]/20 border-t-[#4444ff]"></div>
              <p className="mt-4 text-[#666666] text-sm font-medium">Loading comments...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">😕</div>
              <p className="text-red-600 font-semibold mb-2">Oops! Something went wrong</p>
              <p className="text-[#666666] text-sm mb-4">{error}</p>
              <button 
                onClick={() => window.location.reload()} 
                className="px-4 py-2 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333dd] transition-colors font-medium"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && comments.length === 0 && (
            <div className="text-center py-16">
              <div className="text-7xl mb-4">💭</div>
              <p className="text-[#1a1a1a] font-semibold text-lg mb-2">No comments yet</p>
              <p className="text-[#666666] text-sm">Be the first to share your thoughts!</p>
            </div>
          )}

          {!loading && !error && comments.length > 0 && (
            <div className="space-y-3">
              {comments.map((comment, index) => (
                <div 
                  key={comment.id} 
                  className="group bg-white/80 backdrop-blur-sm rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-white transition-all duration-200 border border-gray-100/50"
                  style={{ 
                    animationDelay: `${index * 50}ms`,
                    animation: 'slideIn 0.3s ease-out forwards',
                    opacity: 0
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar Circle */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full ${getAvatarColor(comment.author)} flex items-center justify-center text-white font-bold text-sm shadow-md`}>
                      {getInitials(comment.author)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      {/* Author and Timestamp */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-bold text-[#1a1a1a] text-sm">
                          {comment.author}
                        </span>
                        <span className="text-xs text-[#666666] font-medium whitespace-nowrap">
                          {formatTimestamp(comment.timestamp)}
                        </span>
                      </div>
                      
                      {/* Comment Text */}
                      <p className="text-[#1a1a1a] leading-relaxed whitespace-pre-wrap">
                        {comment.text}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <style jsx>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>

        {/* Footer */}
        <div className="p-5 border-t border-gray-200/50 bg-gradient-to-b from-transparent to-gray-50/50 rounded-b-2xl">
          <div className="flex items-center justify-center gap-2 text-sm text-[#666666]">
            <span className="font-semibold text-[#1a1a1a]">{comments.length}</span>
            <span>{comments.length === 1 ? 'comment' : 'comments'}</span>
            <span className="text-[#4444ff]">•</span>
            <span className="text-xs">Press ESC to close</span>
          </div>
        </div>
      </div>
    </div>
  )
}

