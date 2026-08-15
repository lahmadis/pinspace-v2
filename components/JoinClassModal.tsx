'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lightbulb } from 'lucide-react'

import { Button, Dialog, Input } from '@/components/ui'
import { toast } from '@/lib/toast'

interface JoinClassModalProps {
  onClose: () => void
}

function normalizeInviteInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      const parts = url.pathname.split('/').filter(Boolean)
      const joinIndex = parts.findIndex((part) => part.toLowerCase() === 'join')
      if (joinIndex >= 0 && parts[joinIndex + 1]) {
        return decodeURIComponent(parts[joinIndex + 1]).trim().toUpperCase()
      }
    }
    return decodeURIComponent(trimmed).toUpperCase()
  } catch {
    return trimmed.toUpperCase()
  }
}

export default function JoinClassModal({ onClose }: JoinClassModalProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return

    const normalizedCode = normalizeInviteInput(inviteCode)
    if (!normalizedCode) {
      toast.error('Please enter an invite code')
      return
    }

    try {
      submittingRef.current = true
      setLoading(true)
      const response = await fetch(`/api/workspaces/by-invite/${encodeURIComponent(normalizedCode)}`)
      if (!response.ok) {
        toast.error('Invalid invite code')
        return
      }
      router.push(`/join/${encodeURIComponent(normalizedCode)}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to validate invite code')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Join a Project"
      description="Use the invite code or full invite link shared by a project member."
      initialFocusRef={inputRef}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="invite-code" className="mb-2 block text-sm font-semibold text-text-primary">
            Invite code or link
          </label>
          <Input
            ref={inputRef}
            id="invite-code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="ABC12345"
            autoComplete="off"
            spellCheck={false}
            className="text-center font-mono text-lg font-bold uppercase tracking-wider"
          />
          <p className="mt-2 text-sm text-text-secondary">Codes are not case-sensitive.</p>
        </div>

        <div className="flex gap-3 rounded-pinspace border border-border bg-background-lighter p-4 text-sm text-text-secondary">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-semibold text-text-primary">Where can I find it?</p>
            <p className="mt-1">Whoever set up the project should have shared an invite link or code with you.</p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!inviteCode.trim()}
            aria-label={loading ? 'Checking invite code' : 'Continue'}
          >
            {loading ? 'Checking…' : 'Continue'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
