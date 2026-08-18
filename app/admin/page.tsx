'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
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
  UserPlus,
  GraduationCap,
  Search,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import CreateStudioForm from '@/components/admin/CreateStudioForm'
import InstructorPicker, { type UserSearchResult } from '@/components/admin/InstructorPicker'

type WorkspaceRow = { id: string; name: string; type?: string; created_at?: string }

type AdminStudio = {
  id: string
  name: string
  type: string
  ownerId: string
  ownerName: string | null
  department: string | null
  academicYear: string | null
  instructorLabel: string | null
  createdAt: string
  provisionedByAdmin: boolean
  isArchived: boolean
  adminIsMember: boolean
}

type AdminInstructor = {
  userId: string
  fullName: string | null
  email: string | null
  organization: string | null
  accountRole: 'instructor' | 'student'
  classCount: number
  hasProfile: boolean
}

type SignupStatus = 'active' | 'no_profile' | 'unverified'

type RecentSignup = {
  userId: string
  email: string | null
  fullName: string | null
  organization: string | null
  createdAt: string
  lastSignInAt: string | null
  status: SignupStatus
}

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

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Mar 14, 2026" */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "2 days ago" */
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < MINUTE) return 'just now'
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  const days = Math.floor(diff / DAY)
  if (days < 30) return plural(days, 'day')
  if (days < 365) return plural(Math.floor(days / 30), 'month')
  return plural(Math.floor(days / 365), 'year')
}

const SIGNUP_STATUS: Record<SignupStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  no_profile: { label: 'No profile', className: 'bg-amber-100 text-amber-800' },
  unverified: { label: 'Unverified', className: 'bg-gray-100 text-gray-600' },
}

function RecentSignupsCard({ signups, loading }: { signups: RecentSignup[]; loading: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-indigo-600" />
        <h2 className="text-sm font-semibold text-gray-900">Recent signups</h2>
        <span className="text-xs text-gray-400 ml-1">newest accounts first</span>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 mx-auto" />
        </div>
      ) : signups.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No signups yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Signed up</th>
                <th className="px-4 py-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((s) => {
                const status = SIGNUP_STATUS[s.status] ?? SIGNUP_STATUS.unverified
                return (
                  <tr key={s.userId} className="border-b border-gray-100 last:border-0 hover:bg-indigo-50/30">
                    <td className="px-4 py-3">
                      {s.fullName ? (
                        <>
                          <p className="font-medium text-gray-900">{s.fullName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{s.email || '—'}</p>
                        </>
                      ) : (
                        <p className="font-medium text-gray-900">{s.email || '—'}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {s.organization ? (
                        <span className="text-gray-700">{s.organization}</span>
                      ) : (
                        <span className="text-gray-400">Personal</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-gray-700">{formatDate(s.createdAt)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{timeAgo(s.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.lastSignInAt ? (
                        <>
                          <p className="text-gray-700">{formatDate(s.lastSignInAt)}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{timeAgo(s.lastSignInAt)}</p>
                        </>
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Everyone who teaches, or could — a filtered admin-side VIEW over accounts and
 * the class studios they own. Not impersonation: nothing here creates, borrows
 * or swaps a session, and clicking through renders an admin report about a
 * person, never that person's own view of the app.
 *
 * Search is client-side over an already-loaded list. The population is small by
 * construction (people who own a class or carry the instructor role), so there
 * is no debounced round trip to justify — unlike InstructorPicker, which
 * searches every account on the platform.
 */
function InstructorsCard({
  instructors,
  loading,
  failed,
}: {
  instructors: AdminInstructor[]
  loading: boolean
  /** The fetch broke. Distinct from an empty list, and must not read as one. */
  failed: boolean
}) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q.length === 0
    ? instructors
    : instructors.filter((i) =>
        (i.fullName ?? '').toLowerCase().includes(q) ||
        (i.email ?? '').toLowerCase().includes(q) ||
        (i.organization ?? '').toLowerCase().includes(q)
      )

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-indigo-600" />
        <h2 className="text-sm font-semibold text-gray-900">Instructors</h2>
        <span className="text-xs text-gray-400 ml-1">owns a class, or has the instructor role</span>
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search instructors"
            className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 mx-auto" />
        </div>
      ) : failed ? (
        <div className="p-8 text-center">
          <p className="text-sm text-amber-700">Couldn’t load instructors.</p>
          <p className="text-xs text-gray-500 mt-1">This is a failed request, not an empty list. Reload to try again.</p>
        </div>
      ) : instructors.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No instructors yet.</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No instructor matches “{query.trim()}”.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">Instructor</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium text-right">Studios</th>
                <th className="px-4 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.userId} className="border-b border-gray-100 last:border-0 hover:bg-indigo-50/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{i.fullName || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {/* Owns a class but cannot create another: POST /api/workspaces
                          gates class creation on account_role. Admin-actionable
                          from /admin/users. */}
                      {i.accountRole !== 'instructor' && (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
                          No instructor role
                        </span>
                      )}
                      {!i.hasProfile && (
                        <span className="text-xs text-gray-400">Has not onboarded</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{i.email || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{i.organization || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{i.classCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/instructors/${i.userId}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      View
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TransferOwnerModal({
  studio,
  onClose,
  onTransferred,
}: {
  studio: AdminStudio
  onClose: () => void
  onTransferred: () => void
}) {
  const [target, setTarget] = useState<UserSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!target) { setError('Pick the new owner'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/studios/${studio.id}/owner`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: target.userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Failed to transfer studio'); return }
      // Ownership moved even when the membership step didn't — the route says so
      // explicitly. Surface that rather than reporting a clean success, since the
      // new owner would be missing from every member-gated query until it's fixed.
      if (data.membershipEnsured === false) {
        toast.error('Ownership transferred, but adding them as instructor failed. Check the studio members.')
      }
      onClose()
      onTransferred()
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Transfer ownership</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-sm font-medium text-gray-900">{studio.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Currently owned by {studio.ownerName || 'an unresolved account'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New owner</label>
            <InstructorPicker
              selected={target}
              onSelect={setTarget}
              emptyHint="No account matches. They must sign up before a studio can be transferred to them."
            />
            <p className="text-xs text-gray-500 mt-1">
              They become the owner and are added as an instructor. The previous owner keeps
              instructor access — their boards stay in this studio — but loses publish, archive,
              delete and enrol.
            </p>
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
              {loading ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StudiosCard({
  studios,
  loading,
  onChanged,
}: {
  studios: AdminStudio[]
  loading: boolean
  onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [transferring, setTransferring] = useState<AdminStudio | null>(null)

  const toggleMembership = async (studio: AdminStudio) => {
    setBusyId(studio.id)
    try {
      const res = await fetch(`/api/admin/studios/${studio.id}/membership`, {
        method: studio.adminIsMember ? 'DELETE' : 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to update membership')
        return
      }
      onChanged()
    } catch {
      toast.error('Request failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-indigo-600" />
        <h2 className="text-sm font-semibold text-gray-900">Studios</h2>
        <span className="text-xs text-gray-400 ml-1">newest first</span>
        <div className="ml-auto">
          <CreateStudioForm onCreated={onChanged} />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 mx-auto" />
        </div>
      ) : studios.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No studios yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">Studio</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Year</th>
                <th className="px-4 py-3 font-medium">Origin</th>
                <th className="px-4 py-3 font-medium text-right">Access</th>
              </tr>
            </thead>
            <tbody>
              {studios.map((s) => (
                <tr key={s.id} className="border-b border-gray-100 last:border-0 hover:bg-indigo-50/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {s.type}
                      {s.isArchived && ' · archived'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <p>{s.ownerName || '—'}</p>
                    <button
                      type="button"
                      onClick={() => setTransferring(s)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline mt-0.5"
                    >
                      Transfer
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.department || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{s.academicYear || '—'}</td>
                  <td className="px-4 py-3">
                    {s.provisionedByAdmin ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800">
                        Provisioned
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Organic</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleMembership(s)}
                      disabled={busyId === s.id}
                      className={`px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50 ${
                        s.adminIsMember
                          ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {busyId === s.id ? '…' : s.adminIsMember ? 'Leave' : 'Join'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {transferring && (
        <TransferOwnerModal
          studio={transferring}
          onClose={() => setTransferring(null)}
          onTransferred={onChanged}
        />
      )}
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
  const [recentSignups, setRecentSignups] = useState<RecentSignup[]>([])
  const [studios, setStudios] = useState<AdminStudio[]>([])
  const [instructors, setInstructors] = useState<AdminInstructor[]>([])
  const [instructorsFailed, setInstructorsFailed] = useState(false)
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
      fetch('/api/admin/recent-signups', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { signups: [] })),
      fetch('/api/admin/studios', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { studios: [] })),
      // `failed` rather than an empty list: "the request broke" and "there are
      // no instructors" render as very different things, and the card must not
      // report the first as the second.
      fetch('/api/admin/instructors', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { instructors: [], failed: true }))
        .catch(() => ({ instructors: [], failed: true })),
    ])
      .then(([overviewData, statsData, signupsData, studiosData, instructorsData]) => {
        setInstitutions(Array.isArray(overviewData?.institutions) ? overviewData.institutions : [])
        setStats(statsData)
        setRecentSignups(Array.isArray(signupsData?.signups) ? signupsData.signups : [])
        setStudios(Array.isArray(studiosData?.studios) ? studiosData.studios : [])
        setInstructors(Array.isArray(instructorsData?.instructors) ? instructorsData.instructors : [])
        setInstructorsFailed(instructorsData?.failed === true)
      })
      .catch(() => {
        setInstitutions([])
        setRecentSignups([])
        setStudios([])
        setInstructors([])
        setInstructorsFailed(true)
      })
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
              <PasswordInput
                id="admin-password"
                value={signInPassword}
                onChange={setSignInPassword}
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
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white/80 transition-colors font-medium text-sm"
            >
              <Users className="w-4 h-4" />
              Users &amp; roles
            </Link>
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

        {/* Studios — pilot provisioning */}
        <InstructorsCard instructors={instructors} loading={loading} failed={instructorsFailed} />

        <StudiosCard studios={studios} loading={loading} onChanged={loadData} />

        {/* Recent signups */}
        <RecentSignupsCard signups={recentSignups} loading={loading} />

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
