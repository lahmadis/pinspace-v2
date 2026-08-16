'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'

import { Button, Dialog, StatusState } from '@/components/ui'

const FEEDBACK_MESSAGE_MAX_LENGTH = 4000

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const setDialogOpen = (next: boolean) => {
    if (!next && submitting) return
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setOpen(next)
    if (!next) {
      setError('')
      setDone(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const trimmed = message.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          page_url: typeof window !== 'undefined' ? window.location.href : null,
        }),
      })
      if (!response.ok) {
        setError('Something went wrong. Please try again.')
        return
      }
      setMessage('')
      setDone(true)
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        setOpen(false)
        setError('')
        setDone(false)
      }, 1500)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] right-5 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary shadow-[var(--shadow-raised)] transition-colors hover:border-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        aria-label="Report a bug or idea"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Report a bug / idea</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={setDialogOpen}
        closeOnOutsideClick={!submitting}
        hideCloseButton={submitting}
        initialFocusRef={textareaRef}
        title="Report a bug or idea"
        description="Found a bug or have an idea? Tell us what happened. We read every message."
      >
        {done ? (
          <StatusState status="success" title="Thanks — we received it." />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="feedback-message" className="mb-1 block text-sm font-semibold text-text-primary">
                Feedback message
              </label>
              <textarea
                ref={textareaRef}
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What happened, or what would make PinSpace better?"
                rows={5}
                maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                disabled={submitting}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'feedback-error feedback-count' : 'feedback-count'}
                className="min-h-36 w-full resize-y rounded-pinspace border border-border bg-background-light px-4 py-3 text-text-primary placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p id="feedback-count" className="mt-1 text-right text-xs text-text-secondary">
                {message.length.toLocaleString()} / {FEEDBACK_MESSAGE_MAX_LENGTH.toLocaleString()}
              </p>
            </div>
            {error && <StatusState id="feedback-error" status="error" title={error} />}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={submitting}
                disabled={!message.trim()}
                aria-label={submitting ? 'Sending feedback' : 'Submit feedback'}
              >
                {submitting ? 'Sending…' : 'Submit'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  )
}
