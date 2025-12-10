'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Board } from '@/types'
import Loading from '@/components/Loading'

export default function MyBoardsPage() {
  const router = useRouter()
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchBoards = async () => {
      try {
        const response = await fetch('/api/my-boards')
        if (response.ok) {
          const data = await response.json()
          setBoards(data.boards)
        }
      } catch (error) {
        console.error('Error fetching boards:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchBoards()
  }, [])

  if (loading) {
    return <Loading message="Loading your boards..." />
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
              onClick={() => router.push('/')}
              className="p-2 hover:bg-background-lighter rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-text-primary">My Boards</h1>
          </div>

          <button
            onClick={() => router.push('/upload')}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Upload New Board
          </button>
        </div>
      </motion.header>

      {/* Main content */}
      <div className="pt-24 px-6 pb-12">
        <div className="max-w-7xl mx-auto">
          {boards.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-20"
            >
              <svg className="w-24 h-24 mx-auto text-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h2 className="text-2xl font-semibold text-text-primary mb-2">No boards yet</h2>
              <p className="text-text-muted mb-6">Upload your first board to get started</p>
              <button
                onClick={() => router.push('/upload')}
                className="px-6 py-3 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
              >
                Upload Your First Board
              </button>
            </motion.div>
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-text-primary">
                  Your Boards ({boards.length})
                </h2>
                <p className="text-text-muted mt-1">
                  All your uploaded boards in one place
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {boards.map((board, index) => (
                  <motion.div
                    key={board.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                    onClick={() => router.push(`/board/${board.id}`)}
                    className="bg-white rounded-xl shadow-lg border border-border overflow-hidden hover:shadow-xl transition-all cursor-pointer group"
                  >
                    {/* Board preview */}
                    <div className="relative aspect-[16/10] bg-background-lighter overflow-hidden">
                      {board.thumbnailUrl && board.thumbnailUrl.startsWith('/uploads/') ? (
                        <img 
                          src={board.thumbnailUrl} 
                          alt={board.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-16 h-16 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      
                      {/* Overlay on hover */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>

                    {/* Board info */}
                    <div className="p-4">
                      <h3 className="font-semibold text-text-primary mb-1 group-hover:text-primary transition-colors">
                        {board.title}
                      </h3>
                      <p className="text-sm text-text-muted mb-3">
                        {board.studentName}
                      </p>
                      
                      {/* Tags */}
                      {board.tags && board.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {board.tags.slice(0, 3).map((tag, idx) => (
                            <span 
                              key={idx}
                              className="px-2 py-1 bg-background-lighter text-text-secondary rounded text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                          {board.tags.length > 3 && (
                            <span className="px-2 py-1 bg-background-lighter text-text-secondary rounded text-xs">
                              +{board.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Upload date */}
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {new Date(board.uploadedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
