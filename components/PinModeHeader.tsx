'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'

interface PinModeHeaderProps {
  boardTitle: string
  onCancel: () => void
}

export default function PinModeHeader({ boardTitle, onCancel }: PinModeHeaderProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      role="status"
      className="fixed inset-x-0 top-0 z-50 max-h-[45dvh] overflow-y-auto border-b border-border/40 bg-primary-dark/90 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-background-light shadow-[var(--shadow-raised)] backdrop-blur-md motion-reduce:transition-none"
    >
      <div className="mx-auto flex max-w-[96rem] flex-col gap-3 px-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {/* Pin Icon */}
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span className="font-mono text-sm font-semibold uppercase">Pin mode</span>
          </div>
          
          {/* Board being pinned */}
          <span className="text-background-light/60" aria-hidden="true">/</span>
          <span className="min-w-0 truncate text-sm">
            Pinning: <span className="font-medium">{boardTitle}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Instructions */}
          <span className="text-sm text-background-light/85">
            Select a wall with pointer or touch. Keyboard users can cancel with Escape and place the board from the wall editor.
          </span>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-pinspace border border-background-light/30 bg-background-light/10 px-4 py-2 text-sm font-semibold text-background-light hover:bg-background-light/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.header>
  )
}
