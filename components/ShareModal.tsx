'use client'

import { useEffect, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

import { Button, Dialog, Input, StatusState } from '@/components/ui'
import { toast } from '@/lib/toast'

interface ShareModalProps {
  studioId: string
  onClose: () => void
}

interface GuestTokenItem {
  id: string
  label: string
  createdAt: string | null
  revoked: boolean
  canComment: boolean
  canTrace: boolean
}

type LoadState = 'loading' | 'ok' | 'error'

export default function ShareModal({ studioId, onClose }: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState('')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [copied, setCopied] = useState(false)

  // Guest critics (owner only). Hidden unless the guest-tokens API returns 200.
  const [guestVisible, setGuestVisible] = useState(false)
  const [guestTokens, setGuestTokens] = useState<GuestTokenItem[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [copiedGuest, setCopiedGuest] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/rooms/${studioId}/share`, { method: 'POST' })
        if (!res.ok) {
          setLoadState('error')
          return
        }
        const data = await res.json()
        setShareUrl(data.shareUrl)
        setLoadState('ok')
      } catch {
        setLoadState('error')
      }
    }
    load()
  }, [studioId])

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      toast.error('Failed to copy link')
    }
  }

  // Load guest links — a 403 means the viewer isn't the owner, so the whole
  // guest-critics section stays hidden.
  useEffect(() => {
    let cancelled = false
    const loadGuests = async () => {
      try {
        const res = await fetch(`/api/rooms/${studioId}/guest-tokens`)
        if (cancelled) return
        if (!res.ok) { setGuestVisible(false); return }
        const data = await res.json()
        setGuestTokens(data.tokens || [])
        setGuestVisible(true)
      } catch {
        if (!cancelled) setGuestVisible(false)
      }
    }
    loadGuests()
    return () => { cancelled = true }
  }, [studioId])

  const createGuestLink = async () => {
    const label = newLabel.trim()
    if (!label || creating) return
    setCreating(true)
    setGuestError(null)
    setCreatedUrl(null)
    try {
      const res = await fetch(`/api/rooms/${studioId}/guest-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setGuestError(data?.error || 'Failed to create link')
        return
      }
      setGuestTokens((prev) => [data.token, ...prev])
      setCreatedUrl(data.critUrl)
      setNewLabel('')
    } catch {
      setGuestError('Failed to create link')
    } finally {
      setCreating(false)
    }
  }

  const revokeGuestLink = async (id: string) => {
    try {
      const res = await fetch(`/api/rooms/${studioId}/guest-tokens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: id }),
      })
      if (res.ok) {
        setGuestTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revoked: true } : t)))
      }
    } catch {
      toast.error('Failed to revoke link')
    }
  }

  // Delete is offered only on already-revoked tokens. The guest's callouts and
  // traces survive (their FK is ON DELETE SET NULL; rows keep their author_name).
  const deleteGuestLink = async (id: string) => {
    try {
      const res = await fetch(`/api/rooms/${studioId}/guest-tokens?tokenId=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setGuestTokens((prev) => prev.filter((t) => t.id !== id))
      } else {
        toast.error('Failed to delete link')
      }
    } catch {
      toast.error('Failed to delete link')
    }
  }

  const copyGuestUrl = async () => {
    if (!createdUrl) return
    try {
      await navigator.clipboard.writeText(createdUrl)
      setCopiedGuest(true)
      setTimeout(() => setCopiedGuest(false), 2000)
    } catch {
      toast.error('Failed to copy link')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title="Share studio"
      description="Invite viewers or create named guest-critic links."
      className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] max-w-xl motion-reduce:transition-none [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
        {/* Loading */}
        {loadState === 'loading' && (
          <StatusState status="loading" title="Generating share link" description="This usually takes only a moment." />
        )}

        {/* Error */}
        {loadState === 'error' && (
          <StatusState status="error" title="Could not create share link" description="You may not have permission to share this studio." />
        )}

        {/* Success */}
        {loadState === 'ok' && (
          <>
            <div className="mb-6 flex justify-center rounded-pinspace bg-background-lighter p-4 sm:p-6">
              <QRCodeCanvas
                value={shareUrl}
                size={200}
                level="H"
                includeMargin={true}
                className="max-w-full rounded-pinspace"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="studio-share-url" className="mb-2 block text-sm font-semibold text-text-primary">
                Shareable link
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <output id="studio-share-url" className="min-h-11 min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-pinspace border border-border bg-background-lighter px-3 py-2 font-mono text-sm text-text-primary">
                  {shareUrl}
                </output>
                <Button
                  type="button"
                  onClick={handleCopyLink}
                  variant={copied ? 'secondary' : 'primary'}
                  aria-live="polite"
                >
                  {copied ? (
                    <span className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M5 13l4 4L19 7"></path>
                      </svg>
                      Copied!
                    </span>
                  ) : (
                    'Copy'
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-pinspace border border-border bg-primary-muted p-4">
              <p className="text-sm text-text-primary">
                <strong>Anyone with this link</strong> can view your studio in 3D.
              </p>
            </div>

            {/* Guest critics — owner-only named, expiring links that can comment + trace */}
            {guestVisible && (
              <section className="mt-5 border-t border-border pt-5" aria-labelledby="guest-critics-heading">
                <h3 id="guest-critics-heading" className="mb-1 text-sm font-bold text-text-primary">Guest critics</h3>
                <p className="mb-3 text-xs text-text-secondary">
                  Named, no-account links that can comment and trace on this room. Revoke anytime.
                </p>

                <div className="flex flex-col gap-2 mb-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label htmlFor="guest-critic-label" className="sr-only">Guest critic name or label</label>
                    <Input
                      id="guest-critic-label"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Critic name or label"
                      className="flex-1"
                      maxLength={100}
                      disabled={creating}
                    />
                    <Button
                      type="button"
                      onClick={() => { void createGuestLink() }}
                      disabled={!newLabel.trim() || creating}
                      loading={creating}
                      className="whitespace-nowrap"
                    >
                      {creating ? 'Creating link…' : 'Create link'}
                    </Button>
                  </div>
                  {guestError && <StatusState status="error" title={guestError} className="p-3 text-sm" />}
                </div>

                {createdUrl && (
                  <div className="mb-3 rounded-pinspace border border-border bg-background-lighter p-3">
                    <p className="mb-1.5 text-xs font-medium text-text-primary">Link created — copy it now. It will not be shown again.</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <output className="min-w-0 flex-1 truncate rounded-pinspace border border-border bg-background-light px-2 py-2 font-mono text-xs text-text-primary">{createdUrl}</output>
                      <Button
                        type="button"
                        size="sm"
                        onClick={copyGuestUrl}
                        variant={copiedGuest ? 'secondary' : 'primary'}
                      >
                        {copiedGuest ? 'Copied!' : 'Copy'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="max-h-40 space-y-1.5 overflow-y-auto" aria-live="polite">
                  {guestTokens.length === 0 && (
                    <p className="text-xs text-text-muted">No guest links yet.</p>
                  )}
                  {guestTokens.map((t) => (
                    <div key={t.id} className="flex min-h-11 items-center justify-between gap-2 rounded-pinspace border border-border bg-background-lighter px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className={`truncate text-xs font-medium ${t.revoked ? 'text-text-muted line-through' : 'text-text-primary'}`}>{t.label}</p>
                      </div>
                      {t.revoked ? (
                        <button
                          type="button"
                          onClick={() => deleteGuestLink(t.id)}
                          className="min-h-11 flex-shrink-0 rounded-pinspace px-3 text-xs font-semibold text-[rgb(var(--color-danger))] hover:bg-[rgb(var(--color-danger)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => revokeGuestLink(t.id)}
                          className="min-h-11 flex-shrink-0 rounded-pinspace px-3 text-xs font-semibold text-[rgb(var(--color-danger))] hover:bg-[rgb(var(--color-danger)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-4 border-t border-border pt-4">
              <p className="text-center text-xs text-text-secondary">
                Scan QR code with phone camera • Or copy link to share
              </p>
            </div>
          </>
        )}
    </Dialog>
  )
}
