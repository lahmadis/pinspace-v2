'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Board } from '@/types'

interface EditModeOverlayProps {
  isVisible: boolean
  wallIndex: number
  onClose: () => void
  onUpload: () => void
  onClearWall?: () => void
  wallBoardCount?: number
  onCopy?: () => void
  onPaste?: () => void
  hasSelection?: boolean
  availableBoards?: Board[] // Optional - kept for API compatibility but not used
  wallDimensions?: { width: number; height: number } | null // Optional - kept for API compatibility but not used
  onBoardSelect?: (board: Board) => void // Optional - kept for API compatibility but not used
  onBoardDragStart?: (board: Board) => void // Optional - kept for API compatibility but not used
}

export function EditModeOverlay({
  isVisible,
  wallIndex,
  onClose,
  onUpload,
  onClearWall,
  wallBoardCount = 0,
}: EditModeOverlayProps) {
  const [clearArmed, setClearArmed] = useState(false)

  const handleClearClick = () => {
    if (!onClearWall) return
    if (!clearArmed) {
      setClearArmed(true)
    } else {
      setClearArmed(false)
      onClearWall()
    }
  }

  return (
    <AnimatePresence onExitComplete={() => setClearArmed(false)}>
      {isVisible && (
        <>
          {/* Header */}
          <motion.section
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            role="region"
            aria-label="Wall editing controls"
            className="fixed inset-x-0 top-0 z-50 flex max-h-[45dvh] flex-col gap-3 overflow-y-auto px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] motion-reduce:transition-none sm:flex-row sm:items-start sm:justify-between sm:px-4"
          >
            <div className="rounded-pinspace border border-border bg-background-light px-4 py-2 text-text-primary shadow-[var(--shadow-raised)]">
              <h2 className="font-mono text-base font-bold">Edit wall {wallIndex + 1}</h2>
              <p className="mt-0.5 text-sm text-text-secondary">Use pointer, touch, or keyboard controls to add and arrange boards.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onClearWall && (
                <button
                  type="button"
                  onClick={handleClearClick}
                  aria-label={clearArmed ? `Confirm clearing ${wallBoardCount} board${wallBoardCount === 1 ? '' : 's'}` : 'Clear wall'}
                  className={clearArmed
                    ? "min-h-11 rounded-pinspace border border-[rgb(var(--color-danger))] bg-[rgb(var(--color-danger))] px-4 py-2 font-semibold text-white hover:bg-[rgb(var(--color-danger)/0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                    : "min-h-11 rounded-pinspace border border-border bg-background-light px-4 py-2 font-semibold text-text-primary hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                  }
                  title={clearArmed ? "Click again to confirm clearing the wall" : "Remove all boards from this wall"}
                >
                  {clearArmed
                    ? `Click again to clear ${wallBoardCount} board${wallBoardCount === 1 ? '' : 's'}`
                    : "Clear wall"
                  }
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-pinspace border border-pinspace-ink bg-primary px-5 py-2 font-semibold text-pinspace-ink shadow-[0_3px_0_rgb(var(--color-ink))] hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
              >
                Save and exit
              </button>
            </div>
          </motion.section>

          {/* Simple Upload Button - No sidebar panel */}
          <motion.div
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -100, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2 motion-reduce:transition-none sm:bottom-auto sm:top-32"
          >
            <button
              type="button"
              onClick={onUpload}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pinspace border border-pinspace-ink bg-primary px-5 py-2.5 font-semibold text-pinspace-ink shadow-[0_3px_0_rgb(var(--color-ink))] hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Add board
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
