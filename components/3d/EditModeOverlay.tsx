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
            <div className="rounded-2xl border border-[#16181D]/[0.08] bg-white px-4 py-3 text-[#16181D] shadow-[0_8px_24px_rgba(22,24,29,0.10)]">
              {/* Zero-padded to match how walls are labelled everywhere else in the
                  room, and no longer prefixed with the verb — the panel it sits in
                  is already the edit surface. */}
              <h2 className="text-base font-bold">Wall {String(wallIndex + 1).padStart(2, '0')}</h2>
              <p className="mt-0.5 text-sm text-[#5A5E6B]">Add, arrange, and edit boards</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onClearWall && (
                <button
                  type="button"
                  onClick={handleClearClick}
                  aria-label={clearArmed ? `Confirm clearing ${wallBoardCount} board${wallBoardCount === 1 ? '' : 's'}` : 'Clear Wall'}
                  className={clearArmed
                    ? "min-h-11 rounded-full bg-[#C2452D] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#a5391f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]"
                    : "min-h-11 rounded-full border border-[#16181D]/[0.12] bg-white px-5 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:border-[#3B6EF6] hover:text-[#3B6EF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]"
                  }
                  title={clearArmed ? "Click again to confirm clearing the wall" : "Remove all boards from this wall"}
                >
                  {clearArmed
                    ? `Click again to clear ${wallBoardCount} board${wallBoardCount === 1 ? '' : 's'}`
                    : "Clear Wall"
                  }
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-full bg-[#16181D] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]"
              >
                Save and Exit
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
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#16181D] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Add Board
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
