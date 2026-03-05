'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import Link from 'next/link'
import type { Institution } from '@/types'
import { Building2, Plus, ExternalLink, Trash2, Pencil, X, MoreVertical } from 'lucide-react'
import { toast } from '@/lib/toast'

export default function AdminInstitutionsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null)
  const [openMenuSlug, setOpenMenuSlug] = useState<string | null>(null)
  const [editingInst, setEditingInst] = useState<Institution | null>(null)
  const [editFormData, setEditFormData] = useState({ name: '', slug: '', type: 'institution' as 'institution' | 'firm', network_label: '', allowed_email_domains: '' })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    type: 'institution' as 'institution' | 'firm',
    network_label: '',
    allowed_email_domains: ''
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) router.push('/sign-in')
      else setUser(session.user)
      setIsLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [router])

  const fetchInstitutions = () => {
    fetch('/api/institutions', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Institution[]) => setInstitutions(Array.isArray(data) ? data : []))
      .catch(() => setInstitutions([]))
  }

  const openEdit = (inst: Institution) => {
    setEditingInst(inst)
    setEditFormData({
      name: inst.name,
      slug: inst.slug,
      type: (inst.type === 'firm' ? 'firm' : 'institution') as 'institution' | 'firm',
      network_label: inst.network_label ?? '',
      allowed_email_domains: inst.allowed_email_domains ?? ''
    })
    setEditError('')
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingInst) return
    setEditError('')
    if (!editFormData.name.trim()) {
      setEditError('Name is required')
      return
    }
    if (!editFormData.slug.trim()) {
      setEditError('Slug is required')
      return
    }
    setEditLoading(true)
    try {
      const res = await fetch(`/api/admin/institutions/${encodeURIComponent(editingInst.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFormData.name.trim(),
          slug: editFormData.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          type: editFormData.type,
          network_label: editFormData.network_label.trim() || undefined,
          allowed_email_domains: editFormData.allowed_email_domains.trim() || undefined
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setEditError(data.error || data.details || 'Failed to update')
        return
      }
      setEditingInst(null)
      fetchInstitutions()
    } catch {
      setEditError('Failed to update institution')
    } finally {
      setEditLoading(false)
    }
  }

  const handleDelete = async (slug: string, name: string) => {
    if (confirmDeleteSlug !== slug) {
      setConfirmDeleteSlug(slug)
      toast.info(`Click Delete again to permanently remove "${name}".`)
      setTimeout(() => setConfirmDeleteSlug(null), 3000)
      return
    }
    setConfirmDeleteSlug(null)
    setFormError('')
    setDeletingSlug(slug)
    try {
      const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data.error || data.details || 'Failed to delete institution')
        return
      }
      fetchInstitutions()
    } catch {
      setFormError('Failed to delete institution')
    } finally {
      setDeletingSlug(null)
    }
  }

  useEffect(() => {
    if (!isLoaded || !user?.id) return
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [isLoaded, user?.id])

  useEffect(() => {
    if (isLoaded) fetchInstitutions()
  }, [isLoaded])

  const handleSlugFromName = () => {
    const slug = formData.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    setFormData((prev) => ({ ...prev, slug }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!formData.name.trim()) {
      setFormError('Name is required')
      return
    }
    if (!formData.slug.trim()) {
      setFormError('Slug is required (e.g. wit, mit)')
      return
    }
    try {
      setLoading(true)
      const res = await fetch('/api/institutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          slug: formData.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          type: formData.type,
          network_label: formData.network_label.trim() || undefined,
          allowed_email_domains: formData.allowed_email_domains.trim() || undefined
        })
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error || (res.status === 403 ? 'Only admins can add institutions. Set PINSPACE_ADMIN_EMAILS in env.' : 'Failed to create')
        setFormError(data.details ? `${msg}: ${data.details}` : msg)
        return
      }
      setFormData({ name: '', slug: '', type: 'institution', network_label: '', allowed_email_domains: '' })
      fetchInstitutions()
    } catch (err) {
      setFormError('Request failed')
    } finally {
      setLoading(false)
    }
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
          <p className="text-gray-600 mb-6">Only admins can manage institutions.</p>
          <Link href="/dashboard" className="text-indigo-600 hover:underline">← Back to Dashboard</Link>
        </div>
      </div>
    )
  }

  if (isAdmin !== true) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="p-2 hover:bg-white/80 rounded-lg transition-colors" title="Back to Admin">
              <span className="text-gray-600">←</span>
            </Link>
            <div className="flex items-center gap-2">
              <Building2 className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Manage institutions & firms</h1>
                <p className="text-sm text-gray-600">Add schools or firms and give each a handoff link</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add institution or firm
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData((p) => ({ ...p, type: e.target.value as 'institution' | 'firm' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="institution">Institution (school / university)</option>
                  <option value="firm">Firm (e.g. architecture firm)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  onBlur={handleSlugFromName}
                  placeholder="e.g. Massachusetts Institute of Technology"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug (URL)</label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="e.g. mit"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Handoff link: /i/{formData.slug || 'slug'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Network label (optional)</label>
                <input
                  type="text"
                  value={formData.network_label}
                  onChange={(e) => setFormData((p) => ({ ...p, network_label: e.target.value }))}
                  placeholder="e.g. MIT Design Network"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Allowed email domains</label>
                <input
                  type="text"
                  value={formData.allowed_email_domains}
                  onChange={(e) => setFormData((p) => ({ ...p, allowed_email_domains: e.target.value }))}
                  placeholder="e.g. wit.edu or wit.edu,wentworth.edu"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Only these domains can join this org&apos;s workspaces. Leave blank for no restriction.</p>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
              >
                {loading ? 'Adding…' : `Add ${formData.type === 'firm' ? 'firm' : 'institution'}`}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">All institutions & firms</h2>
            <ul className="space-y-3">
              {institutions.length === 0 ? (
                <li className="text-gray-500 text-sm">None yet. Add one to get started.</li>
              ) : (
                institutions.map((inst) => (
                  <li key={inst.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="font-medium text-gray-900 flex items-center gap-2">
                        {inst.name}
                        <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${inst.type === 'firm' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
                          {inst.type === 'firm' ? 'Firm' : 'Institution'}
                        </span>
                      </p>
                      <p className="text-sm text-gray-500">{inst.slug} {inst.network_label ? `· ${inst.network_label}` : ''} {inst.allowed_email_domains ? `· ${inst.allowed_email_domains}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/institutions/${inst.slug}`} className="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                        View stats
                      </Link>
                      <a
                        href={`/i/${inst.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1"
                        title="Open explore"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMenuSlug(openMenuSlug === inst.slug ? null : inst.slug)}
                          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                          title="More actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openMenuSlug === inst.slug && (
                          <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-10">
                            <button
                              type="button"
                              onClick={() => {
                                openEdit(inst)
                                setOpenMenuSlug(null)
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                              <Pencil className="w-4 h-4" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleDelete(inst.slug, inst.name)
                                setOpenMenuSlug(null)
                              }}
                              disabled={deletingSlug === inst.slug}
                              className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>Admin:</strong> Only users listed in <code className="bg-amber-100 px-1 rounded">PINSPACE_ADMIN_EMAILS</code> can add institutions or firms. Each gets a link <code className="bg-amber-100 px-1 rounded">/i/[slug]</code> (e.g. /i/wit).
        </div>

        {editingInst && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setEditingInst(null)}>
            <div className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Edit institution</h3>
                <button type="button" onClick={() => setEditingInst(null)} className="p-1 text-gray-500 hover:text-gray-700 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={editFormData.type}
                    onChange={(e) => setEditFormData((p) => ({ ...p, type: e.target.value as 'institution' | 'firm' }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="institution">Institution (school / university)</option>
                    <option value="firm">Firm (e.g. architecture firm)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Massachusetts Institute of Technology"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Slug (URL)</label>
                  <input
                    type="text"
                    value={editFormData.slug}
                    onChange={(e) => setEditFormData((p) => ({ ...p, slug: e.target.value }))}
                    placeholder="e.g. mit"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">Handoff link: /i/{editFormData.slug || 'slug'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Network label (optional)</label>
                  <input
                    type="text"
                    value={editFormData.network_label}
                    onChange={(e) => setEditFormData((p) => ({ ...p, network_label: e.target.value }))}
                    placeholder="e.g. MIT Design Network"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Allowed email domains</label>
                  <input
                    type="text"
                    value={editFormData.allowed_email_domains}
                    onChange={(e) => setEditFormData((p) => ({ ...p, allowed_email_domains: e.target.value }))}
                    placeholder="e.g. wit.edu or wit.edu,wentworth.edu"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                {editError && <p className="text-sm text-red-600">{editError}</p>}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingInst(null)}
                    className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editLoading}
                    className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                  >
                    {editLoading ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
