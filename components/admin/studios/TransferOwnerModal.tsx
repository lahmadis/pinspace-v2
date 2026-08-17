'use client'

import { useState } from 'react'
import { Button, Dialog, StatusState } from '@/components/ui'
import InstructorPicker, { type UserSearchResult } from '@/components/admin/InstructorPicker'
import type { AdminStudio } from '@/types/admin'
import { transferOwnerSchema } from '@/lib/validations/admin'
import { transferStudioOwnerApi } from '@/lib/api/admin'
import { toast } from '@/lib/toast'

export interface TransferOwnerModalProps {
  studio: AdminStudio
  onClose: () => void
  onTransferred: () => void
}

export function TransferOwnerModal({
  studio,
  onClose,
  onTransferred,
}: TransferOwnerModalProps) {
  const [target, setTarget] = useState<UserSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    const parseResult = transferOwnerSchema.safeParse({
      ownerId: target?.userId,
    })

    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Pick the new owner')
      return
    }

    setLoading(true)
    try {
      const data = await transferStudioOwnerApi(studio.id, parseResult.data)
      if (data.membershipEnsured === false) {
        toast.error('Ownership transferred, but adding them as instructor failed. Check the studio members.')
      } else {
        toast.success('Studio ownership transferred successfully')
      }
      onClose()
      onTransferred()
    } catch (err: any) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !loading) onClose()
      }}
      closeOnOutsideClick={!loading}
      hideCloseButton={loading}
      title="Transfer ownership?"
      description="Confirm the new owner and review exactly which permissions change."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="px-3 py-2 bg-background border border-border rounded-lg">
          <p className="text-sm font-medium text-text-primary">{studio.name}</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Currently owned by {studio.ownerName || 'an unresolved account'}
          </p>
        </div>
        <div>
          <InstructorPicker
            label="New owner"
            selected={target}
            onSelect={setTarget}
            emptyHint="No account matches. They must sign up before a studio can be transferred to them."
          />
          <p className="text-xs text-text-secondary mt-1">
            They become the owner and are added as an instructor. The previous owner keeps
            instructor access — their boards stay in this studio — but loses publish, archive,
            delete and enrol.
          </p>
        </div>

        {error && <StatusState status="error" title={error} />}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel transfer
          </Button>
          <Button
            type="submit"
            loading={loading}
            aria-label={loading ? 'Transferring ownership' : 'Confirm ownership transfer'}
          >
            {loading ? 'Transferring…' : 'Transfer'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export default TransferOwnerModal
