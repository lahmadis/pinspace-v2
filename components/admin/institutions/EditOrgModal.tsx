'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import { Button, Dialog, DialogActions, FormField, Input, Select } from '@/components/ui'
import { DomainChipInput } from './DomainChipInput'
import type { InstitutionWithCount, OrgDomainItem } from '@/types/admin'
import { editOrgSchema } from '@/lib/validations/admin'
import {
  getOrgDomainsApi,
  addOrgDomainApi,
  removeOrgDomainApi,
  updateInstitutionApi,
  deleteInstitutionApi,
} from '@/lib/api/admin'
import { toast } from '@/lib/toast'

export interface EditOrgModalProps {
  inst: InstitutionWithCount
  onClose: () => void
  onSaved: () => void
}

export function EditOrgModal({ inst, onClose, onSaved }: EditOrgModalProps) {
  const [form, setForm] = useState({
    name: inst.name,
    slug: inst.slug,
    type: (inst.type === 'firm' ? 'firm' : 'university') as 'university' | 'firm',
    network_label: inst.network_label ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)

  // Domain management — fetched live on open
  const [domains, setDomains] = useState<OrgDomainItem[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState('')
  const [domainAdding, setDomainAdding] = useState(false)
  const [domainRemoving, setDomainRemoving] = useState<string | null>(null)
  const mutationPending = loading || deleting || domainAdding || domainRemoving !== null

  useEffect(() => {
    getOrgDomainsApi(inst.slug)
      .then((data) => {
        setDomains(Array.isArray(data.domains) ? data.domains : [])
      })
      .catch(() => {})
      .finally(() => setDomainsLoading(false))
  }, [inst.slug])

  const handleDomainAdd = async (d: string) => {
    if (mutationPending) return
    if (d.startsWith('\x00INVALID:')) {
      setDomainError('Invalid format — use e.g. wit.edu')
      return
    }
    setDomainError('')
    setDomainAdding(true)
    try {
      const data = await addOrgDomainApi(inst.slug, d)
      setDomains((prev) => [...prev, data.domain])
      toast.success(`Added domain ${d}`)
    } catch (err: any) {
      setDomainError(err.message || 'Failed to add domain')
    } finally {
      setDomainAdding(false)
    }
  }

  const handleDomainRemove = async (domainId: string, domainStr: string) => {
    if (mutationPending) return
    setDomainError('')
    setDomainRemoving(domainId)
    try {
      await removeOrgDomainApi(inst.slug, domainStr)
      setDomains((prev) => prev.filter((d) => d.id !== domainId))
      toast.success(`Removed domain ${domainStr}`)
    } catch (err: any) {
      setDomainError(err.message || 'Failed to remove domain')
    } finally {
      setDomainRemoving(null)
    }
  }

  const handleDelete = async () => {
    if (mutationPending) return
    setDeleting(true)
    try {
      await deleteInstitutionApi(inst.slug)
      toast.success('Organization deleted')
      onClose()
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Failed to delete')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mutationPending) return
    setError('')

    const parseResult = editOrgSchema.safeParse(form)
    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Invalid form input')
      return
    }

    setLoading(true)
    try {
      await updateInstitutionApi(inst.slug, parseResult.data)
      toast.success('Organization updated')
      onClose()
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Failed to update')
    } finally {
      setLoading(false)
    }
  }

  const beginDeleteConfirmation = () => {
    setConfirmDelete(true)
    window.setTimeout(() => deleteCancelRef.current?.focus(), 0)
  }

  const cancelDeleteConfirmation = () => {
    setConfirmDelete(false)
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !mutationPending) onClose()
      }}
      closeOnOutsideClick={!mutationPending}
      hideCloseButton={mutationPending}
      title="Edit organization"
      description={`Update ${inst.name} without changing its existing access contract.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField id="edit-org-type" label="Type">
          {(controlProps) => (
            <Select
              {...controlProps}
              value={form.type}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
            >
              <option value="university">University (school)</option>
              <option value="firm">Firm</option>
            </Select>
          )}
        </FormField>

        <FormField id="edit-org-name" label="Name">
          {(controlProps) => (
            <Input
              {...controlProps}
              value={form.name}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          )}
        </FormField>

        <FormField id="edit-org-slug" label="Slug" description={`Handoff link: /i/${form.slug || 'slug'}`}>
          {(controlProps) => (
            <Input
              {...controlProps}
              value={form.slug}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
            />
          )}
        </FormField>

        <FormField id="edit-org-network-label" label="Network label" description="Optional">
          {(controlProps) => (
            <Input
              {...controlProps}
              value={form.network_label}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
            />
          )}
        </FormField>

        <div>
          <label htmlFor="edit-org-domain" className="block text-sm font-medium text-text-primary mb-2">
            Allowed email domains
          </label>
          {domainsLoading ? (
            <p className="text-xs text-text-dim">Loading…</p>
          ) : (
            <>
              {domains.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {domains.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-muted text-accent rounded-md text-xs font-semibold border border-accent/30"
                    >
                      {d.domain}
                      <button
                        type="button"
                        onClick={() => handleDomainRemove(d.id, d.domain)}
                        disabled={mutationPending}
                        aria-label={`Remove ${d.domain}`}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent/20 hover:text-accent focus-visible:outline-none"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <DomainChipInput
                inputId="edit-org-domain"
                domains={[]}
                onAdd={handleDomainAdd}
                onRemove={() => {}}
                error={domainError}
                onErrorClear={() => setDomainError('')}
                disabled={mutationPending}
              />
              {domainAdding && <p className="text-xs text-text-dim mt-1">Adding…</p>}
            </>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <DialogActions>
          <Button
            type="button"
            onClick={() => {
              if (!mutationPending) onClose()
            }}
            disabled={mutationPending}
            variant="secondary"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={mutationPending && !loading}
            className="flex-1"
          >
            Save changes
          </Button>
        </DialogActions>
      </form>

      {/* Delete zone */}
      <div className="mt-5 pt-4 border-t border-border">
        {!confirmDelete ? (
          <Button
            ref={deleteTriggerRef}
            type="button"
            onClick={beginDeleteConfirmation}
            disabled={mutationPending}
            variant="danger"
          >
            <Trash2 className="w-4 h-4" />
            Delete org
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-danger font-medium">
              Delete <span className="font-bold">{inst.name}</span>? This cannot be undone.
            </p>
            <DialogActions>
              <Button
                ref={deleteCancelRef}
                type="button"
                onClick={cancelDeleteConfirmation}
                disabled={mutationPending}
                variant="secondary"
                className="flex-1"
              >
                Keep org
              </Button>
              <Button
                type="button"
                onClick={handleDelete}
                loading={deleting}
                disabled={mutationPending && !deleting}
                variant="danger"
                className="flex-1"
              >
                Yes, delete
              </Button>
            </DialogActions>
          </div>
        )}
      </div>
    </Dialog>
  )
}

export default EditOrgModal
