'use client'

import { useEffect, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

interface ShareModalProps {
  studioId: string
  onClose: () => void
}

export default function ShareModal({ studioId, onClose }: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Generate share URL
    const url = `${window.location.origin}/studio/${studioId}/view`
    setShareUrl(url)
    
    // Trigger entrance animation
    setTimeout(() => setIsVisible(true), 10)
  }, [studioId])

  useEffect(() => {
    // Close on ESC key
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(onClose, 200) // Wait for animation
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      
      // Reset after 2 seconds
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      alert('Failed to copy link')
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  return (
    <div 
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      <div 
        className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform transition-all duration-300 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              🔗 Share Studio
            </h2>
            <p className="text-sm text-gray-600">
              Share for critique and comments
            </p>
          </div>
          
          <button
            onClick={handleClose}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg 
              className="w-5 h-5 text-gray-500" 
              fill="none" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth="2" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-6 p-6 bg-gray-50 rounded-xl">
          {shareUrl && (
            <QRCodeCanvas 
              value={shareUrl}
              size={200}
              level="H"
              includeMargin={true}
              className="rounded-lg"
            />
          )}
        </div>

        {/* Shareable Link */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Shareable Link
          </label>
          <div className="flex gap-2">
            <div className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg font-mono text-sm text-gray-800 overflow-x-auto whitespace-nowrap">
              {shareUrl}
            </div>
            <button
              onClick={handleCopyLink}
              className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap ${
                copied 
                  ? 'bg-green-500 text-white' 
                  : 'bg-[#4444ff] text-white hover:bg-[#3333ee]'
              }`}
            >
              {copied ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                  Copied!
                </span>
              ) : (
                'Copy'
              )}
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-sm text-blue-900">
            <strong>📱 Anyone with this link</strong> can view your studio and leave comments. 
            No sign-in required!
          </p>
        </div>

        {/* Instructions */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Scan QR code with phone camera • Or copy link to share
          </p>
        </div>
      </div>
    </div>
  )
}

