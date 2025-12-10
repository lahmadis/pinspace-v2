'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface JoinClassModalProps {
  onClose: () => void
}

export default function JoinClassModal({ onClose }: JoinClassModalProps) {
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!inviteCode.trim()) {
      alert('Please enter an invite code')
      return
    }

    try {
      setLoading(true)

      // Check if code is valid
      const response = await fetch(`/api/workspaces/by-invite/${inviteCode.trim()}`)
      
      if (!response.ok) {
        alert('Invalid invite code')
        return
      }

      // Redirect to join page
      router.push(`/join/${inviteCode.trim()}`)
    } catch (error) {
      console.error('Error:', error)
      alert('Failed to validate invite code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Modal */}
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Join a Class</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="inviteCode" className="block text-sm font-medium text-gray-700 mb-2">
                Enter Invite Code
              </label>
              <input
                type="text"
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="ABC12345"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] focus:border-transparent text-center text-xl font-mono font-bold tracking-wider"
                maxLength={8}
                autoFocus
              />
              <p className="mt-2 text-sm text-gray-500">
                Enter the 8-character code shared by your instructor
              </p>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex gap-2">
                <span className="text-xl">💡</span>
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">Where to find the code?</p>
                  <p className="text-blue-800">
                    Your instructor should have shared an invite link or code via email, Canvas, or in class.
                  </p>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !inviteCode.trim()}
                className="flex-1 px-4 py-3 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
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

