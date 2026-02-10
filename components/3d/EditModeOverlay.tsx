'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface EditModeOverlayProps {
  isVisible: boolean
  wallIndex: number
  onClose: () => void
  onUpload: () => void
  onClearWall?: () => void
  onCopy?: () => void
  onPaste?: () => void
  hasSelection?: boolean
  availableBoards?: any[] // Optional - kept for API compatibility but not used
  wallDimensions?: { width: number; height: number } | null // Optional - kept for API compatibility but not used
  onBoardSelect?: (board: any) => void // Optional - kept for API compatibility but not used
  onBoardDragStart?: (board: any) => void // Optional - kept for API compatibility but not used
}

export function EditModeOverlay({
  isVisible,
  wallIndex,
  onClose,
  onUpload,
  onClearWall,
  onCopy,
  onPaste,
  hasSelection
}: EditModeOverlayProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Header */}
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between"
          >
            <div className="px-4 py-2 bg-indigo-600 rounded-lg shadow-lg">
              <h2 className="text-xl font-semibold text-white">Edit Wall {wallIndex + 1}</h2>
              <p className="text-sm text-white/90">Drag and drop boards to arrange them on the wall</p>
            </div>
            <div className="flex items-center gap-3">
              {onClearWall && (
                <button
                  onClick={onClearWall}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-lg"
                  title="Remove all boards from this wall"
                >
                  Clear wall
                </button>
              )}
              <button
                onClick={onClose}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-lg"
              >
                Save & Exit
              </button>
            </div>
          </motion.div>

          {/* Simple Upload Button - No sidebar panel */}
          <motion.div
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -100, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="fixed left-6 top-32 z-50 flex flex-col gap-2"
          >
            <button
              onClick={onUpload}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Add Your Board
            </button>
            {onCopy && (
              <button
                onClick={onCopy}
                disabled={!hasSelection}
                className="px-6 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
                title="Copy selected board (Ctrl+C)"
              >
                Copy
              </button>
            )}
            {onPaste && (
              <button
                onClick={onPaste}
                className="px-6 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors shadow-lg"
                title="Paste board on this wall (Ctrl+V)"
              >
                Paste
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}