'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'

interface JoinClassModalProps {
  onClose: () => void
}

// `variant` used to switch this copy between 'Room' (firm orgs) and 'Class'
// (universities); it was a pure noun swap with no behavioural difference, and
// it was fed straight from accountMode === 'firm'. One vocabulary now, matching
// the dashboard.
export default function JoinClassModal({ onClose }: JoinClassModalProps) {
  const noun = 'Project'
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  // In-flight guard. This handler only validates the code and navigates (creates
  // no row), but a same-tick double-submit would double-navigate; the ref stops
  // the second call past the stale `loading` render value.
  const submittingRef = useRef(false)

  const normalizeInviteInput = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    try {
      if (/^https?:\/\//i.test(trimmed)) {
        const url = new URL(trimmed)
        const parts = url.pathname.split('/').filter(Boolean)
        const joinIdx = parts.findIndex((p) => p.toLowerCase() === 'join')
        if (joinIdx >= 0 && parts[joinIdx + 1]) {
          return decodeURIComponent(parts[joinIdx + 1]).trim().toUpperCase()
        }
      }
    } catch {
      // Fall through to plain code handling.
    }
    return decodeURIComponent(trimmed).toUpperCase()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return

    const normalizedCode = normalizeInviteInput(inviteCode)
    if (!normalizedCode) {
      toast.error('Please enter an invite code')
      return
    }

    try {
      submittingRef.current = true
      setLoading(true)

      // Check if code is valid
      const response = await fetch(`/api/workspaces/by-invite/${encodeURIComponent(normalizedCode)}`)
      
      if (!response.ok) {
        toast.error('Invalid invite code')
        return
      }

      // Redirect to join page
      router.push(`/join/${encodeURIComponent(normalizedCode)}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to validate invite code')
    } finally {
      // Re-enable on success and failure so a failed check can be retried.
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#16181D]/30 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className="bg-white rounded-3xl shadow-[0_30px_90px_rgba(22,24,29,0.3)] max-w-md w-full p-8"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-extrabold text-[#16181D]">Join a {noun}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-[#16181D]/10 hover:border-[#3B6EF6] hover:text-[#3B6EF6] transition-colors"
            >
              <svg className="w-4 h-4 text-[#5A5E6B]" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="inviteCode" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-2">
                Enter Invite Code
              </label>
              <input
                type="text"
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="ABC12345"
                className="w-full px-4 py-3 border border-[#16181D]/12 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent text-center text-xl font-mono font-bold tracking-wider"
                autoFocus
              />
              <p className="mt-2 text-sm text-[#8A8FA0]">
                Enter the 8-character code or paste the full invite link
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 border border-[#16181D]/12 text-[#5A5E6B] rounded-full hover:bg-[#16181D]/5 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !inviteCode.trim()}
                className="flex-1 px-4 py-3 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
              >
                {loading ? 'Checking...' : 'Continue'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

