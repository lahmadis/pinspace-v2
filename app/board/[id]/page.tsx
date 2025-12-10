'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Board, Comment } from '@/types'
import Loading from '@/components/Loading'

export default function BoardDetailPage() {
  const params = useParams()
  const router = useRouter()
  const boardId = params.id as string
  const [board, setBoard] = useState<Board | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [commentForm, setCommentForm] = useState({
    authorName: '',
    authorEmail: '',
    content: ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const fetchBoard = async () => {
      try {
        const response = await fetch(`/api/boards/${boardId}`)
        if (response.ok) {
          const data = await response.json()
          setBoard(data.board)
        }
      } catch (error) {
        console.error('Error fetching board:', error)
      } finally {
        setLoading(false)
      }
    }

    const fetchComments = async () => {
      try {
        const response = await fetch(`/api/comments?boardId=${boardId}`)
        if (response.ok) {
          const data = await response.json()
          setComments(data.comments)
        }
      } catch (error) {
        console.error('Error fetching comments:', error)
      }
    }

    fetchBoard()
    fetchComments()
  }, [boardId])

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId,
          ...commentForm
        })
      })

      if (response.ok) {
        const data = await response.json()
        setComments([...comments, data.comment])
        setCommentForm({ authorName: '', authorEmail: '', content: '' })
        setShowCommentForm(false)
        alert('Comment added!')
      }
    } catch (error) {
      alert('Failed to add comment')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <Loading message="Loading board..." />
  }

  if (!board) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-text-muted">Board not found</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <motion.header 
        className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-border shadow-sm"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-background-lighter rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">{board.title}</h1>
              <p className="text-sm text-text-muted">{board.studentName}</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                if (board.fullImageUrl) {
                  const link = document.createElement('a')
                  link.href = board.fullImageUrl
                  link.download = `${board.studentName}-${board.title}.jpg`
                  link.click()
                }
              }}
              className="px-4 py-2 bg-background-lighter hover:bg-background-light text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors border border-border"
            >
              Download
            </button>
            <button 
              onClick={() => {
                const url = window.location.href
                navigator.clipboard.writeText(url).then(() => {
                  alert('Link copied to clipboard!')
                })
              }}
              className="px-4 py-2 bg-background-lighter hover:bg-background-light text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors border border-border"
            >
              Share
            </button>
            <button 
              onClick={() => setShowCommentForm(!showCommentForm)}
              className="px-4 py-2 bg-primary-muted hover:bg-primary text-white rounded-lg text-sm transition-colors"
            >
              Add Comment
            </button>
          </div>
        </div>
      </motion.header>

      {/* Main content */}
      <div className="pt-24 px-6 pb-12">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Board image - 2 columns */}
            <motion.div 
              className="lg:col-span-2 space-y-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="bg-white rounded-xl shadow-lg border border-border overflow-hidden">
                <div className="relative aspect-[16/10] bg-background-lighter">
                  {board.fullImageUrl && board.fullImageUrl.startsWith('/uploads/') ? (
                    <img 
                      src={board.fullImageUrl} 
                      alt={board.title}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5"/>
                          </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#grid)" />
                      </svg>
                      <div className="relative text-center p-8">
                        <p className="text-text-muted text-lg">{board.title}</p>
                        <p className="text-text-secondary text-sm mt-2">Board Preview</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Comments Section */}
              <div className="bg-white rounded-xl shadow-lg border border-border p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-text-primary">
                    Comments ({comments.length})
                  </h2>
                </div>

                {/* Comment Form */}
                {showCommentForm && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    onSubmit={handleSubmitComment}
                    className="mb-6 p-4 bg-background-lighter rounded-lg space-y-3"
                  >
                    <input
                      type="text"
                      placeholder="Your name *"
                      value={commentForm.authorName}
                      onChange={(e) => setCommentForm({...commentForm, authorName: e.target.value})}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                      required
                    />
                    <input
                      type="email"
                      placeholder="Your email (optional)"
                      value={commentForm.authorEmail}
                      onChange={(e) => setCommentForm({...commentForm, authorEmail: e.target.value})}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                    />
                    <textarea
                      placeholder="Write your comment... *"
                      value={commentForm.content}
                      onChange={(e) => setCommentForm({...commentForm, content: e.target.value})}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                      rows={3}
                      required
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        {submitting ? 'Posting...' : 'Post Comment'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCommentForm(false)}
                        className="px-4 py-2 bg-background-lighter hover:bg-background-light text-text-secondary rounded-lg text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.form>
                )}

                {/* Comments List */}
                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <p className="text-text-muted text-sm text-center py-8">
                      No comments yet. Be the first to comment!
                    </p>
                  ) : (
                    comments.map((comment) => (
                      <motion.div
                        key={comment.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-background-lighter rounded-lg"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-text-primary text-sm">
                              {comment.authorName}
                            </p>
                            <p className="text-xs text-text-muted">
                              {new Date(comment.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <p className="text-text-primary text-sm whitespace-pre-wrap">
                          {comment.content}
                        </p>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>

            {/* Board info sidebar - 1 column */}
            <motion.div 
              className="lg:col-span-1 space-y-6"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              {/* Student info */}
              <div className="bg-white rounded-xl shadow-lg border border-border p-6">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Student</h2>
                <div className="space-y-2">
                  <p className="text-text-primary font-medium">{board.studentName}</p>
                  {board.studentEmail && (
                    <p className="text-text-muted text-sm">{board.studentEmail}</p>
                  )}
                  <div className="pt-2 text-sm text-text-muted">
                    <p>Uploaded {new Date(board.uploadedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {/* Project info */}
              <div className="bg-white rounded-xl shadow-lg border border-border p-6">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Project Details</h2>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-text-secondary mb-1">Title</h3>
                    <p className="text-text-primary">{board.title}</p>
                  </div>
                  {board.description && (
                    <div>
                      <h3 className="text-sm font-medium text-text-secondary mb-1">Description</h3>
                      <p className="text-text-primary text-sm">{board.description}</p>
                    </div>
                  )}
                  {board.tags && board.tags.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-text-secondary mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {board.tags.map((tag, index) => (
                          <span 
                            key={index}
                            className="px-3 py-1 bg-primary-muted/10 text-primary rounded-full text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}