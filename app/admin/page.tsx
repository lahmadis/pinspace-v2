'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import Link from 'next/link'
import {
  Building2,
  ExternalLink,
  LayoutDashboard,
  BarChart3,
  Briefcase,
  ChevronRight,
  ChevronDown,
  Users,
  LayoutGrid,
  Plus,
  X,
  Pencil,
  Trash2,
  Inbox,
} from 'lucide-react'

type WorkspaceRow = { id: string; name: string; type?: string; created_at?: string }

type InstitutionWithCount = {
  id: string
  name: string
  slug: string
  network_label?: string | null
  type?: 'university' | 'firm' | null
  workspace_count: number
  user_count: number
  workspaces: WorkspaceRow[]
  domains: string[]
}

type OrgRequest = {
  id: string
  email: string
  domain: string
  requested_at: string
  requested_type?: 'university' | 'firm'
}

function relativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

function StatBlock({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
        <p className="text-sm text-gray-500">No data yet</p>
      </div>
    )
  }
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
      <ul className="space-y-1">
        {entries.map(([key, count]) => (
          <li key={key} className="flex justify-between text-sm">
            <span className="text-gray-600 truncate max-w-[140px]">{key}</span>
            <span className="font-medium text-gray-900">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DomainChipInput({
  domains,
  onAdd,
  onRemove,
  error,
  onErrorClear,
}: {
  domains: string[]
  onAdd: (d: string) => void
  onRemove: (d: string) => void
  error: string
  onErrorClear: () => void
}) {
  const [input, setInput] = useState('')

  const commit = () => {
    const d = input.trim().toLowerCase().replace(/^https?:\/\//i, '')
    onErrorClear()
    if (!d) return
    if (!DOMAIN_RE.test(d)) {
      onAdd('\x00INVALID:' + d)
      return
    }
    onAdd(d)
    setInput('')
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          placeholder="e.g. wit.edu"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
        />
        <button
          type="button"
          onClick={commit}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {domains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium border border-indigo-100">
              {d}
              <button type="button" onClick={() => onRemove(d)} className="text-indigo-400 hover:text-indigo-600 ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateOrgForm({ onCreated }: { onCreated: () => void }) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim() || !form.slug.trim()) {
      setError('Name and slug are required')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/institutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          type: form.type,
          network_label: form.network_label.trim() || undefined,
          domains,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create')
        return
      }
      reset()
      setOpen(false)
      onCreated()
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        New org
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { reset(); setOpen(false) }}>
          <div
            className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">Create organization</h3>
              <button type="button" onClick={() => { reset(); setOpen(false) }} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="university">University (school)</option>
                  <option value="firm">Firm</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  onBlur={autoSlug}
                  placeholder="e.g. Wentworth Institute of Technology"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="e.g. wit"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Handoff link: /i/{form.slug || 'slug'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Network label <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.network_label}
                  onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
                  placeholder="e.g. WIT Design Network"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Allowed email domains
                </label>
                <DomainChipInput
                  domains={domains}
                  onAdd={handleDomainAdd}
                  onRemove={(d) => setDomains((prev) => prev.filter((x) => x !== d))}
                  error={domainError}
                  onErrorClear={() => setDomainError('')}
                />
                <p className="text-xs text-gray-500 mt-1">Leave empty for no restriction.</p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { reset(); setOpen(false) }}
                  className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm"
                >
                  {loading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function OrgRow({ inst, onEdit }: { inst: InstitutionWithCount; onEdit: (inst: InstitutionWithCount) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <li className="border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-4 px-6 py-4 hover:bg-indigo-50/30 transition-colors">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="p-1 text-gray-400 hover:text-gray-600 rounded shrink-0"
          title={expanded ? 'Collapse' : 'Show studios'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 text-gray-300" />}
        </button>

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 truncate">{inst.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            /i/{inst.slug}
            {inst.domains?.length ? ` · ${inst.domains.join(', ')}` : ' · no domain restriction'}
          </p>
        </div>

        {/* Counts */}
        <div className="flex items-center gap-5 shrink-0">
          <span className="flex items-center gap-1 text-sm text-gray-600 whitespace-nowrap" title="Users">
            <Users className="w-4 h-4 text-gray-400" />
            {inst.user_count}
          </span>
          <span className="flex items-center gap-1 text-sm text-gray-600 whitespace-nowrap" title="Studio rooms">
            <LayoutGrid className="w-4 h-4 text-gray-400" />
            {inst.workspace_count}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/admin/institutions/${inst.slug}`}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50 whitespace-nowrap"
          >
            Full stats
          </Link>
          <button
            type="button"
            onClick={() => onEdit(inst)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <a
            href={`/i/${inst.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            title="Open explore"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Expanded studio list */}
      {expanded && (
        <div className="px-6 pb-4 ml-10">
          {inst.workspaces.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No studio rooms yet</p>
          ) : (
            <ul className="space-y-1.5">
              {inst.workspaces.map((ws) => (
                <li key={ws.id} className="flex items-center justify-between text-sm text-gray-600 py-1 border-b border-gray-50 last:border-0">
                  <span className="font-medium text-gray-800">{ws.name || 'Unnamed'}</span>
                  <span className="text-xs text-gray-400">
                    {ws.type || 'class'} · {ws.created_at ? new Date(ws.created_at).toLocaleDateString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function EditOrgModal({
  inst,
  onClose,
  onSaved,
}: {
  inst: InstitutionWithCount
  onClose: () => void
  onSaved: () => void
}) {
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

  // Domain management — fetched live on open
  const [domains, setDomains] = useState<{ id: string; domain: string }[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState('')
  const [domainAdding, setDomainAdding] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/institutions/${encodeURIComponent(inst.slug)}/domains`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { domains?: { id: string; domain: string }[] }) => {
        setDomains(Array.isArray(data.domains) ? data.domains : [])
      })
      .catch(() => {})
      .finally(() => setDomainsLoading(false))
  }, [inst.slug])

  const handleDomainAdd = async (d: string) => {
    if (d.startsWith('\x00INVALID:')) {
      setDomainError('Invalid format — use e.g. wit.edu')
      return
    }
    setDomainError('')
    setDomainAdding(true)
    try {
      const res = await fetch(`/api/admin/institutions/${encodeURIComponent(inst.slug)}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: d }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDomainError(data.error || 'Failed to add domain')
        return
      }
      setDomains((prev) => [...prev, data.domain])
    } catch {
      setDomainError('Request failed')
    } finally {
      setDomainAdding(false)
    }
  }

  const handleDomainRemove = async (domainId: string, domainStr: string) => {
    setDomainError('')
    try {
      const res = await fetch(
        `/api/admin/institutions/${encodeURIComponent(inst.slug)}/domains/${encodeURIComponent(domainStr)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = await res.json()
        setDomainError(data.error || 'Failed to remove domain')
        return
      }
      setDomains((prev) => prev.filter((d) => d.id !== domainId))
    } catch {
      setDomainError('Request failed')
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/institutions/${encodeURIComponent(inst.slug)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to delete')
        setDeleting(false)
        setConfirmDelete(false)
        return
      }
      onClose()
      onSaved()
    } catch {
      setError('Request failed')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim() || !form.slug.trim()) {
      setError('Name and slug are required')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/institutions/${encodeURIComponent(inst.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          type: form.type,
          network_label: form.network_label.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update')
        return
      }
      onClose()
      onSaved()
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Edit org</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="university">University (school)</option>
              <option value="firm">Firm</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Handoff link: /i/{form.slug || 'slug'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Network label <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={form.network_label}
              onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Allowed email domains</label>
            {domainsLoading ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : (
              <>
                {domains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {domains.map((d) => (
                      <span key={d.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium border border-indigo-100">
                        {d.domain}
                        <button
                          type="button"
                          onClick={() => handleDomainRemove(d.id, d.domain)}
                          className="text-indigo-400 hover:text-indigo-600 ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <DomainChipInput
                  domains={[]}
                  onAdd={handleDomainAdd}
                  onRemove={() => {}}
                  error={domainError}
                  onErrorClear={() => setDomainError('')}
                />
                {domainAdding && <p className="text-xs text-gray-400 mt-1">Adding…</p>}
              </>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm"
            >
              {loading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        {/* Delete zone */}
        <div className="mt-5 pt-4 border-t border-gray-100">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4" />
              Delete org
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-red-700 font-medium">Delete <span className="font-bold">{inst.name}</span>? This cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-1.5 px-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
                >
                  Keep org
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-1.5 px-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ApproveModal({
  request,
  orgs,
  onDone,
  onClose,
}: {
  request: OrgRequest
  orgs: InstitutionWithCount[]
  onDone: () => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [form, setForm] = useState({
    name: '',
    slug: '',
    type: (request.requested_type === 'firm' ? 'firm' : 'university') as 'university' | 'firm',
    network_label: '',
  })
  const [orgId, setOrgId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const autoSlug = () => {
    if (form.slug) return
    setForm((p) => ({
      ...p,
      slug: p.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body =
        mode === 'new'
          ? { mode: 'new', name: form.name.trim(), slug: form.slug.trim(), type: form.type, network_label: form.network_label.trim() || null }
          : { mode: 'existing', org_id: orgId }
      const res = await fetch(`/api/admin/org-requests/${request.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok || res.status === 409) {
        onDone()
        return
      }
      const data = await res.json()
      setError(data.error || 'Failed to approve')
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }

  const universities = orgs.filter((o) => (o.type || 'university') === 'university')
  const firms = orgs.filter((o) => o.type === 'firm')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Approve request</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-only domain chip */}
        <div className="mb-4 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-400 mb-1">Approving domain</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-sm font-mono border border-gray-200">
              {request.domain}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium border ${
                request.requested_type === 'firm'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200'
              }`}
            >
              Requester said: {request.requested_type === 'firm' ? 'Firm' : 'University'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">from {request.email}</p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-5">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'new' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Create new org
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'existing' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Add to existing org
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'new' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="university">University (school)</option>
                  <option value="firm">Firm</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  onBlur={autoSlug}
                  placeholder="e.g. Wentworth Institute of Technology"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="e.g. wit"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Handoff link: /i/{form.slug || 'slug'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Network label <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.network_label}
                  onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
                  placeholder="e.g. WIT Design Network"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select org</label>
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="">— choose an org —</option>
                {universities.length > 0 && (
                  <optgroup label="Universities">
                    {universities.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </optgroup>
                )}
                {firms.length > 0 && (
                  <optgroup label="Firms">
                    {firms.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (mode === 'existing' && !orgId)}
              className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm"
            >
              {loading ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PendingRequestsPanel({
  orgs,
  onRefresh,
}: {
  orgs: InstitutionWithCount[]
  onRefresh: () => void
}) {
  const [requests, setRequests] = useState<OrgRequest[]>([])
  const [fetchError, setFetchError] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/org-requests', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { requests?: OrgRequest[] }) => {
        setRequests(Array.isArray(data.requests) ? data.requests : [])
      })
      .catch(() => setFetchError(true))
  }, [])

  const removeRequest = (id: string) => setRequests((prev) => prev.filter((r) => r.id !== id))

  const handleReject = async (id: string) => {
    setRejectingId(id)
    try {
      const res = await fetch(`/api/admin/org-requests/${id}/reject`, { method: 'PATCH' })
      if (res.ok || res.status === 409) {
        const wasLast = requests.length === 1
        removeRequest(id)
        if (wasLast) onRefresh()
      }
    } finally {
      setRejectingId(null)
      setRejectConfirmId(null)
    }
  }

  if (fetchError || requests.length === 0) return null

  const approvingRequest = approvingId ? requests.find((r) => r.id === approvingId) ?? null : null

  return (
    <>
      <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
          <Inbox className="w-4 h-4 text-amber-600" />
          <h2 className="text-base font-semibold text-amber-900">Pending requests</h2>
          <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium border border-amber-200">
            {requests.length}
          </span>
        </div>
        <ul>
          {requests.map((req) => (
            <li key={req.id} className="border-b border-gray-100 last:border-0 px-6 py-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 font-mono text-sm">{req.domain}</p>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium border ${
                      req.requested_type === 'firm'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}
                  >
                    {req.requested_type === 'firm' ? 'Firm' : 'University'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{req.email} · {relativeTime(req.requested_at)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setApprovingId(req.id)}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium"
                >
                  Approve
                </button>
                {rejectConfirmId === req.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRejectConfirmId(null)}
                      className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(req.id)}
                      disabled={rejectingId === req.id}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {rejectingId === req.id ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRejectConfirmId(req.id)}
                    className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-red-600 hover:border-red-200"
                  >
                    Reject
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {approvingRequest && (
        <ApproveModal
          request={approvingRequest}
          orgs={orgs}
          onDone={() => {
            const wasLast = requests.length === 1
            removeRequest(approvingRequest.id)
            setApprovingId(null)
            if (wasLast) onRefresh()
          }}
          onClose={() => setApprovingId(null)}
        />
      )}
    </>
  )
}

export default function AdminDashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [institutions, setInstitutions] = useState<InstitutionWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInError, setSignInError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [editingInst, setEditingInst] = useState<InstitutionWithCount | null>(null)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [stats, setStats] = useState<{
    total: number
    by_year: Record<string, number>
    by_major: Record<string, number>
    by_age_range: Record<string, number>
    by_how_heard: Record<string, number>
  } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null)
      setIsLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
      setIsLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError('')
    if (!signInEmail.trim() || !signInPassword) {
      setSignInError('Email and password required')
      return
    }
    setSigningIn(true)
    const { error } = await supabase.auth.signInWithPassword({ email: signInEmail.trim(), password: signInPassword })
    setSigningIn(false)
    if (error) {
      setSignInError(error.message || 'Sign in failed')
    }
  }

  useEffect(() => {
    if (!isLoaded || !user?.id) return
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [isLoaded, user?.id])

  const loadData = () => {
    if (!isAdmin) return
    setLoading(true)
    Promise.all([
      fetch('/api/admin/overview', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { institutions: [] })),
      fetch('/api/admin/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([overviewData, statsData]) => {
        setInstitutions(Array.isArray(overviewData?.institutions) ? overviewData.institutions : [])
        setPendingRequestCount(overviewData?.pending_request_count ?? 0)
        setStats(statsData)
      })
      .catch(() => setInstitutions([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl border border-gray-200">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">PinSpace Admin</h1>
            <p className="text-sm text-gray-500 mt-1">Sign in with your admin email</p>
          </div>
          <form onSubmit={handleAdminSignIn} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="admin-email"
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@gmail.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                id="admin-password"
                type="password"
                value={signInPassword}
                onChange={(e) => setSignInPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="current-password"
              />
            </div>
            {signInError && <p className="text-sm text-red-600">{signInError}</p>}
            <button
              type="submit"
              disabled={signingIn}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
          <p className="text-gray-600 mb-6">This account is not in PINSPACE_ADMIN_EMAILS.</p>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="text-indigo-600 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  const institutionsList = institutions.filter((i) => (i.type || 'university') === 'university')
  const firmsList = institutions.filter((i) => i.type === 'firm')

  const renderOrgSection = (
    list: InstitutionWithCount[],
    title: string,
    description: string,
    icon: React.ReactNode,
    emptyMsg: string
  ) => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500">{description}</p>
          </div>
        </div>
        {/* Column headers */}
        {list.length > 0 && (
          <div className="hidden sm:flex items-center gap-5 mr-32 text-xs text-gray-400 font-medium uppercase tracking-wide">
            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Users</span>
            <span className="flex items-center gap-1"><LayoutGrid className="w-3 h-3" /> Studios</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 mx-auto" />
        </div>
      ) : list.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <p className="font-medium text-gray-700">{emptyMsg}</p>
          <p className="mt-1 text-sm">Create one with the button above.</p>
        </div>
      ) : (
        <ul>
          {list.map((inst) => (
            <OrgRow key={inst.id} inst={inst} onEdit={setEditingInst} />
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50 to-indigo-50">
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="p-2 hover:bg-white/80 rounded-lg transition-colors text-gray-600">←</Link>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="w-7 h-7 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
                <p className="text-sm text-gray-500">Orgs, users, and studios</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CreateOrgForm onCreated={loadData} />
            <button
              onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-white/80 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Global student stats */}
        {stats && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-gray-900">Global stats</h2>
              <span className="text-xs text-gray-400 ml-1">{stats.total} profiles</span>
            </div>
            <div className="p-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <StatBlock title="By year" data={stats.by_year} />
              <StatBlock title="By major" data={stats.by_major} />
              <StatBlock title="By age range" data={stats.by_age_range} />
              <StatBlock title="How they heard" data={stats.by_how_heard} />
            </div>
          </div>
        )}

        {/* Pending org requests */}
        {pendingRequestCount > 0 && (
          <PendingRequestsPanel orgs={institutions} onRefresh={loadData} />
        )}

        {/* Orgs */}
        {renderOrgSection(
          institutionsList,
          'Institutions',
          'Schools and universities — click a row to expand studio rooms.',
          <Building2 className="w-4 h-4 text-indigo-600" />,
          'No institutions yet.'
        )}
        {renderOrgSection(
          firmsList,
          'Firms',
          'Architecture and design firms.',
          <Briefcase className="w-4 h-4 text-amber-500" />,
          'No firms yet.'
        )}

        <p className="text-xs text-gray-400 text-center mt-2">
          User counts reflect profiles with <code>institution_id</code> set. Studio counts are workspaces linked to this org.
        </p>
      </div>

      {editingInst && (
        <EditOrgModal
          inst={editingInst}
          onClose={() => setEditingInst(null)}
          onSaved={() => { setEditingInst(null); loadData() }}
        />
      )}
    </div>
  )
}
