'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface QuickNotePanelProps {
  boardId: string
  boardTitle: string
  onAddNote: (note: string, author: string) => Promise<void>
}

export default function QuickNotePanel({ boardId, boardTitle, onAddNote }: QuickNotePanelProps) {
  const [note, setNote] = useState('')
  const [author, setAuthor] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!note.trim() || !author.trim()) return

    setSubmitting(true)
    try {
      await onAddNote(note, author)
      setNote('')
    } catch (error) {
      alert('Failed to add note')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-6 right-6 w-96 bg-white rounded-xl shadow-2xl border border-border p-4 z-40"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
        <h3 className="font-semibold text-text-primary text-sm">
          Taking Notes: {boardTitle}
        </h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {!author && (
          <input
            type="text"
            placeholder="Your name"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm"
            autoFocus
          />
        )}
        
        <textarea
          placeholder="Quick note from the critique..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none"
          rows={3}
          disabled={!author}
        />

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !note.trim() || !author.trim()}
            className="flex-1 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add Note'}
          </button>
        </div>
      </form>

      <p className="text-xs text-text-muted mt-2">
        💡 Capturing feedback for the presenter
      </p>
    </motion.div>
  )
}