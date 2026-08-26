'use client'

import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'

/**
 * Floating "Report a bug / idea" button + modal. Self-contained: manages its own
 * open/submit state and POSTs a single message to /api/feedback. Mounted once on
 * the dashboard, fixed to the bottom-right corner so it's always reachable but
 * out of the way. Uses the app's standard modal pattern (fixed inset-0 backdrop).
 */
export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const close = () => {
    setOpen(false)
    setError('')
    setDone(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          page_url: typeof window !== 'undefined' ? window.location.href : null,
        }),
      })
      if (!res.ok) {
        setError('Something went wrong. Please try again.')
        return
      }
      setMessage('')
      setDone(true)
      // Briefly show the success state, then close.
      setTimeout(() => close(), 1500)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-3.5 py-2.5 bg-white/85 border border-[#16181D]/10 text-[#5A5E6B] rounded-full shadow-md hover:shadow-lg hover:text-[#3B6EF6] hover:border-[#3B6EF6] transition-all text-sm font-semibold"
        aria-label="Report a bug or idea"
      >
        <MessageSquarePlus className="w-4 h-4" />
        <span className="hidden sm:inline">Report a bug / idea</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-[#16181D]/30 z-50 flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-white rounded-3xl shadow-[0_30px_90px_rgba(22,24,29,0.3)] max-w-md w-full p-7"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <div className="text-center py-6">
                <div className="text-3xl mb-2">✓</div>
                <p className="text-[#16181D] font-bold">Thanks — got it!</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-extrabold text-[#16181D]">Report a bug / idea</h3>
                  <button
                    type="button"
                    onClick={close}
                    className="w-8 h-8 flex items-center justify-center rounded-full border border-[#16181D]/10 hover:border-[#3B6EF6] hover:text-[#3B6EF6] transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-4 h-4 text-[#5A5E6B]" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm text-[#5A5E6B] mb-4">
                  Found a bug or have an idea? Tell us anything — we read every message.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What's on your mind?"
                    rows={5}
                    className="w-full px-4 py-3 border border-[#16181D]/12 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent resize-none"
                    autoFocus
                  />
                  {error && <p className="text-sm text-[#C2452D]">{error}</p>}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={close}
                      className="flex-1 px-4 py-2.5 border border-[#16181D]/12 text-[#5A5E6B] rounded-full hover:bg-[#16181D]/5 transition-colors font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !message.trim()}
                      className="flex-1 px-4 py-2.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
                    >
                      {submitting ? 'Sending…' : 'Submit'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
