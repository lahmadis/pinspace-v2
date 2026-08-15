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
  participants,
  activeBoardTitle,
  onEndCrit
}: CritModeHeaderProps) {
  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      role="status"
      className="fixed inset-x-0 top-0 z-50 max-h-[45dvh] overflow-y-auto border-b border-[rgb(var(--color-danger))] bg-[rgb(var(--color-danger)/0.95)] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-[var(--shadow-raised)] backdrop-blur-md motion-reduce:transition-none"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {/* Live Indicator */}
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-white motion-safe:animate-pulse" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold uppercase">Live crit</span>
          </div>
          
          {/* Active Board */}
          {activeBoardTitle && (
            <>
              <span className="text-white/60" aria-hidden="true">/</span>
              <span className="min-w-0 truncate text-sm">
                Presenting: <span className="font-medium">{activeBoardTitle}</span>
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Participants */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span className="text-sm">{participants.length} active</span>
          </div>

          {/* End Crit Button */}
          <button
            type="button"
            onClick={onEndCrit}
            className="min-h-11 rounded-pinspace border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            End Crit
          </button>
        </div>
      </div>
    </motion.header>
  )
}
