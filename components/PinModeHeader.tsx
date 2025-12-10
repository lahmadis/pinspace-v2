'use client'

import { motion } from 'framer-motion'

interface PinModeHeaderProps {
  boardTitle: string
  onCancel: () => void
}

export default function PinModeHeader({ boardTitle, onCancel }: PinModeHeaderProps) {
  return (
    <motion.div
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 bg-primary text-white border-b-2 border-primary-dark shadow-lg"
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Pin Icon */}
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span className="font-semibold">PIN MODE</span>
          </div>
          
          {/* Board being pinned */}
          <span className="text-white/80">|</span>
          <span className="text-sm">
            Pinning: <span className="font-medium">{boardTitle}</span>
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Instructions */}
          <span className="text-sm text-white/90">
            Click on a wall to pin your board
          </span>

          {/* Cancel Button */}
          <button
            onClick={onCancel}
            className="px-4 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors border border-white/30"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  )
}