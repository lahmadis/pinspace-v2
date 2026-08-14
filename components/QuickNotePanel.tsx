'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from '@/lib/toast'

interface QuickNotePanelProps {
  boardId: string
  boardTitle: string
  onAddNote: (note: string, author: string) => Promise<void>
}

export default function QuickNotePanel({ boardTitle, onAddNote }: QuickNotePanelProps) {
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
    } catch {
      toast.error('Failed to add note')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.aside
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label={`Quick note for ${boardTitle}`}
      className="fixed inset-x-[max(1rem,env(safe-area-inset-left))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 max-h-[min(70dvh,30rem)] overflow-y-auto rounded-kova-lg border border-border bg-background-light p-4 text-text-primary shadow-[var(--shadow-raised)] motion-reduce:transition-none sm:left-auto sm:right-[max(1rem,env(safe-area-inset-right))] sm:w-96"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-[rgb(var(--color-danger))] motion-safe:animate-pulse" aria-hidden="true" />
        <h3 className="font-semibold text-text-primary text-sm">
          Taking Notes: {boardTitle}
        </h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {!author && (
          <>
            <label htmlFor="quick-note-author" className="sr-only">Your name</label>
            <input
              id="quick-note-author"
              type="text"
              placeholder="Your name"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="min-h-11 w-full rounded-kova border border-border bg-background-light px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              autoFocus
            />
          </>
        )}
        
        <label htmlFor="quick-note-content" className="sr-only">Critique note</label>
        <textarea
          id="quick-note-content"
          placeholder="Quick note from the critique..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full resize-y rounded-kova border border-border bg-background-light px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-background-lighter"
          rows={3}
          disabled={!author}
        />

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !note.trim() || !author.trim()}
            aria-label={submitting ? 'Adding note' : 'Add note'}
            aria-busy={submitting || undefined}
            className="min-h-11 flex-1 rounded-kova border border-kova-ink bg-primary px-4 py-2 text-sm font-semibold text-kova-ink shadow-[0_3px_0_rgb(var(--color-ink))] hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            {submitting ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </form>

      <p className="text-xs text-text-muted mt-2">
        💡 Capturing feedback for the presenter
      </p>
    </motion.aside>
  )
}
