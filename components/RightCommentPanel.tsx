'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Comment, Board } from '@/types'

interface RightCommentPanelProps {
  board: Board | null
  onClose: () => void
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

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getAvatarColor(name: string): string {
  const colors = ['bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500']
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

export default function RightCommentPanel({ board, onClose }: RightCommentPanelProps) {
  const [user, setUser] = useState<any>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = board !== null
  const authorName = user?.user_metadata?.email?.split('@')[0] || 'Anonymous'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })
    
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!board) {
      setComments([])
      setNewComment('')
      return
    }
    fetchComments()
  }, [board?.id])

  useEffect(() => {
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
      const response = await fetch(`/api/boards/${board.id}/comments`)
      if (!response.ok) throw new Error('Failed to fetch')
      const data = await response.json()
      setComments(data.comments || [])
    } catch (err) {
      console.error('Error:', err)
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
        body: JSON.stringify({ content: newComment.trim(), authorName: authorName }),
      })
      if (!response.ok) throw new Error('Failed to post')
      const data = await response.json()
      setComments(prev => [...prev, data.comment])
      setNewComment('')
      textareaRef.current?.focus()
    } catch (err) {
      alert('Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Side Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200 flex-shrink-0">
          <div className="flex-1 pr-3">
            <h3 className="font-bold text-gray-900 text-base leading-tight mb-1">
              {board?.title}
            </h3>
            <p className="text-xs text-gray-500">
              {board?.studentName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {/* Comments */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4444ff]/20 border-t-[#4444ff]"></div>
            </div>
          )}

          {!loading && comments.length === 0 && (
            <div className="text-center py-12">
              <div className="text-5xl mb-2">💭</div>
              <p className="text-gray-500 text-sm">No comments yet</p>
            </div>
          )}

          {!loading && comments.map((comment) => (
            <div key={comment.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
              <div className={`w-8 h-8 rounded-full ${getAvatarColor(comment.authorName)} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>
                {getInitials(comment.authorName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-semibold text-gray-900 text-sm">{comment.authorName}</span>
                  <span className="text-xs text-gray-500">{formatTimestamp(comment.createdAt)}</span>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{comment.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="border-t border-gray-200 p-5 bg-gray-50 flex-shrink-0">
          {user ? (
            <>
              <textarea
                ref={textareaRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handlePost()
                  }
                }}
                placeholder="Add a comment..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] resize-none mb-3"
                rows={3}
              />
              <button
                onClick={handlePost}
                disabled={!newComment.trim() || posting}
                className="w-full px-4 py-2 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] disabled:opacity-50 transition-all text-sm font-semibold"
              >
                {posting ? 'Posting...' : 'Post Comment'}
              </button>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-600 mb-3">Sign in to leave a comment</p>
              <a
                href="/sign-in"
                className="inline-block px-6 py-2 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-all text-sm font-semibold"
              >
                Sign In
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

