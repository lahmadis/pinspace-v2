'use client'

import { motion } from 'framer-motion'

interface CritModeHeaderProps {
  sessionId: string
  hostName: string
  participants: string[]
  activeBoardTitle?: string
  onEndCrit: () => void
}

export default function CritModeHeader({ 
  sessionId, 
  hostName, 
  participants, 
  activeBoardTitle,
  onEndCrit 
}: CritModeHeaderProps) {
  return (
    <motion.div
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white border-b-2 border-red-700 shadow-lg"
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Live Indicator */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
            <span className="font-semibold">LIVE CRIT</span>
          </div>
          
          {/* Active Board */}
          {activeBoardTitle && (
            <>
              <span className="text-white/60">|</span>
              <span className="text-sm">
                Presenting: <span className="font-medium">{activeBoardTitle}</span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Participants */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span className="text-sm">{participants.length} active</span>
          </div>

          {/* End Crit Button */}
          <button
            onClick={onEndCrit}
            className="px-4 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors border border-white/30"
          >
            End Crit
          </button>
        </div>
      </div>
    </motion.div>
  )
}