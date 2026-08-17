'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Dialog, DialogActions, FormField, Input, Select } from '@/components/ui'
import { DomainChipInput } from './DomainChipInput'
import { createInstitutionApi } from '@/lib/api/admin'
import { createOrgSchema } from '@/lib/validations/admin'
import { toast } from '@/lib/toast'

export interface CreateOrgModalProps {
  onCreated: () => void
  triggerLabel?: string
}

export function CreateOrgModal({ onCreated, triggerLabel = 'New org' }: CreateOrgModalProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    slug: '',
    type: 'university' as 'university' | 'firm',
    network_label: '',
  })
  const [domains, setDomains] = useState<string[]>([])
  const [domainError, setDomainError] = useState('')

  const autoSlug = () => {
    if (form.slug) return
    setForm((p) => ({
      ...p,
      slug: p.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    }))
  }

  const handleDomainAdd = (d: string) => {
    if (d.startsWith('\x00INVALID:')) {
      setDomainError('Invalid format — use e.g. wit.edu')
      return
    }
    if (domains.includes(d)) {
      setDomainError('Already added')
      return
    }
    setDomains((prev) => [...prev, d])
  }

  const reset = () => {
    setForm({ name: '', slug: '', type: 'university', network_label: '' })
    setDomains([])
    setDomainError('')
    setError('')
  }

  const setDialogOpen = (next: boolean) => {
    if (!next && loading) return
    if (!next) reset()
    setOpen(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    const parseResult = createOrgSchema.safeParse({
      name: form.name,
      slug: form.slug,
      type: form.type,
      network_label: form.network_label,
      domains,
    })

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || 'Invalid form input'
      setError(firstError)
      return
    }

    setLoading(true)
    try {
      await createInstitutionApi(parseResult.data)
      toast.success('Organization created successfully')
      reset()
      setOpen(false)
      onCreated()
    } catch (err: any) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button type="button" className="min-h-11 h-11 px-4 font-semibold inline-flex items-center gap-2" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4" />
        {triggerLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={setDialogOpen}
        closeOnOutsideClick={!loading}
        hideCloseButton={loading}
        title="Create organization"
        description="Create an institution or firm and define its verified email domains."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField id="create-org-type" label="Type">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={form.type}
                onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
              >
                <option value="university">University (school)</option>
                <option value="firm">Firm</option>
              </Select>
            )}
          </FormField>

          <FormField id="create-org-name" label="Name">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                onBlur={autoSlug}
                placeholder="e.g. Wentworth Institute of Technology"
              />
            )}
          </FormField>

          <FormField id="create-org-slug" label="Slug" description={`Handoff link: /i/${form.slug || 'slug'}`}>
            {(controlProps) => (
              <Input
                {...controlProps}
                value={form.slug}
                onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                placeholder="e.g. wit"
              />
            )}
          </FormField>

          <FormField id="create-org-network-label" label="Network label" description="Optional">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={form.network_label}
                onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
                placeholder="e.g. WIT Design Network"
              />
            )}
          </FormField>

          <div>
            <label htmlFor="create-org-domain" className="block text-sm font-medium text-text-primary mb-1">
              Allowed email domains
            </label>
            <DomainChipInput
              inputId="create-org-domain"
              domains={domains}
              onAdd={handleDomainAdd}
              onRemove={(d) => setDomains((prev) => prev.filter((x) => x !== d))}
              error={domainError}
              onErrorClear={() => setDomainError('')}
            />
            <p className="text-xs text-text-secondary mt-1">Leave empty for no restriction.</p>
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <DialogActions>
            <Button
              type="button"
              onClick={() => setDialogOpen(false)}
              variant="secondary"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
              className="flex-1"
            >
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  )
}

export default CreateOrgModal
