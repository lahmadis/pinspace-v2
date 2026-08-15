'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import Link from 'next/link'
import {
  Building2,
  ExternalLink,
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
import { Button, Dialog, StatusState } from '@/components/ui'
import { AdminShell } from '@/components/admin/AdminShell'

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
        <h3 className="text-sm font-medium text-text-primary mb-2">{title}</h3>
        <p className="text-sm text-text-secondary">No data yet</p>
      </div>
    )
  }
  return (
    <div>
      <h3 className="text-sm font-medium text-text-primary mb-2">{title}</h3>
      <ul className="space-y-1">
        {entries.map(([key, count]) => (
          <li key={key} className="flex justify-between text-sm">
            <span className="text-text-secondary truncate max-w-[140px]">{key}</span>
            <span className="font-medium text-text-primary">{count}</span>
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
  active: { label: 'Active', className: 'bg-success/15 text-success' },
  no_profile: { label: 'No profile', className: 'bg-warning/15 text-warning' },
  unverified: { label: 'Unverified', className: 'bg-background-lighter text-text-secondary' },
}

function RecentSignupsCard({ signups, loading }: { signups: RecentSignup[]; loading: boolean }) {
  return (
    <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-3 border-b border-border bg-background flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">Recent signups</h2>
        <span className="text-xs text-text-dim ml-1">newest accounts first</span>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-accent mx-auto" />
        </div>
      ) : signups.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">No signups yet.</div>
      ) : (
        <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" tabIndex={0} role="region" aria-label="Administrative data table">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
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
                  <tr key={s.userId} className="border-b border-border last:border-0 hover:bg-primary-muted">
                    <td className="px-4 py-3">
                      {s.fullName ? (
                        <>
                          <p className="font-medium text-text-primary">{s.fullName}</p>
                          <p className="text-xs text-text-dim mt-0.5">{s.email || '—'}</p>
                        </>
                      ) : (
                        <p className="font-medium text-text-primary">{s.email || '—'}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {s.organization ? (
                        <span className="text-text-primary">{s.organization}</span>
                      ) : (
                        <span className="text-text-dim">Personal</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-text-primary">{formatDate(s.createdAt)}</p>
                      <p className="text-xs text-text-dim mt-0.5">{timeAgo(s.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.lastSignInAt ? (
                        <>
                          <p className="text-text-primary">{formatDate(s.lastSignInAt)}</p>
                          <p className="text-xs text-text-dim mt-0.5">{timeAgo(s.lastSignInAt)}</p>
                        </>
                      ) : (
                        <span className="text-text-dim">Never</span>
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
    <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-3 border-b border-border bg-background flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">Instructors</h2>
        <span className="text-xs text-text-dim ml-1">owns a class, or has the instructor role</span>
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search instructors"
            className="pl-8 pr-3 py-1.5 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent text-sm w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-accent mx-auto" />
        </div>
      ) : failed ? (
        <div className="p-8 text-center">
          <p className="text-sm text-warning">Couldn’t load instructors.</p>
          <p className="text-xs text-text-secondary mt-1">This is a failed request, not an empty list. Reload to try again.</p>
        </div>
      ) : instructors.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">No instructors yet.</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">No instructor matches “{query.trim()}”.</div>
      ) : (
        <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" tabIndex={0} role="region" aria-label="Administrative data table">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
                <th className="px-4 py-3 font-medium">Instructor</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium text-right">Studios</th>
                <th className="px-4 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.userId} className="border-b border-border last:border-0 hover:bg-primary-muted">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{i.fullName || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {/* Owns a class but cannot create another: POST /api/workspaces
                          gates class creation on account_role. Admin-actionable
                          from /admin/users. */}
                      {i.accountRole !== 'instructor' && (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-warning/15 text-warning">
                          No instructor role
                        </span>
                      )}
                      {!i.hasProfile && (
                        <span className="text-xs text-text-dim">Has not onboarded</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{i.email || '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">{i.organization || '—'}</td>
                  <td className="px-4 py-3 text-right text-text-primary tabular-nums">{i.classCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/instructors/${i.userId}`}
                      className="inline-flex min-h-11 items-center gap-1 rounded-pinspace px-2 text-xs font-medium text-accent hover:bg-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
    if (loading) return
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
    <Dialog
      open
      onOpenChange={(next) => { if (!next && !loading) onClose() }}
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
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel transfer</Button>
            <Button type="submit" loading={loading} aria-label={loading ? 'Transferring ownership' : 'Confirm ownership transfer'}>
              {loading ? 'Transferring…' : 'Transfer'}
            </Button>
          </div>
        </form>
    </Dialog>
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
    <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-3 border-b border-border bg-background flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">Studios</h2>
        <span className="text-xs text-text-dim ml-1">newest first</span>
        <div className="ml-auto">
          <CreateStudioForm onCreated={onChanged} />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-accent mx-auto" />
        </div>
      ) : studios.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">No studios yet.</div>
      ) : (
        <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" tabIndex={0} role="region" aria-label="Administrative data table">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
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
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-primary-muted">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{s.name}</p>
                    <p className="text-xs text-text-dim mt-0.5">
                      {s.type}
                      {s.isArchived && ' · archived'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    <p>{s.ownerName || '—'}</p>
                    <button
                      type="button"
                      onClick={() => setTransferring(s)}
                      className="text-xs text-accent hover:text-accent hover:underline mt-0.5"
                    >
                      Transfer
                    </button>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{s.department || '—'}</td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{s.academicYear || '—'}</td>
                  <td className="px-4 py-3">
                    {s.provisionedByAdmin ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-primary-muted text-accent">
                        Provisioned
                      </span>
                    ) : (
                      <span className="text-xs text-text-dim">Organic</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleMembership(s)}
                      disabled={busyId === s.id}
                      className={`min-h-11 rounded-pinspace px-2.5 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                        s.adminIsMember
                          ? 'border border-border text-text-primary hover:bg-background'
                          : 'bg-accent text-background-light hover:bg-accent-light'
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
  inputId,
  domains,
  onAdd,
  onRemove,
  error,
  onErrorClear,
  disabled = false,
}: {
  inputId: string
  domains: string[]
  onAdd: (d: string) => void
  onRemove: (d: string) => void
  error: string
  onErrorClear: () => void
  disabled?: boolean
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
          id={inputId}
          type="text"
          disabled={disabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          placeholder="e.g. wit.edu"
          className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
        />
        <button
          type="button"
          onClick={commit}
          disabled={disabled}
          className="min-h-11 px-3 py-2 bg-background-lighter hover:bg-background-lighter text-text-primary rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {domains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-muted text-accent rounded text-xs font-medium border border-accent">
              {d}
              <button type="button" onClick={() => onRemove(d)} disabled={disabled} aria-label={`Remove ${d}`} className="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-pinspace text-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
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

  const setDialogOpen = (next: boolean) => {
    if (!next && loading) return
    if (!next) reset()
    setOpen(next)
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
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-pinspace px-4 py-2 bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent text-background-light rounded-lg hover:bg-accent-light transition-colors font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        New org
      </button>

      <Dialog
        open={open}
        onOpenChange={setDialogOpen}
        closeOnOutsideClick={!loading}
        hideCloseButton={loading}
        title="Create organization"
        description="Create an institution or firm and define its verified email domains."
      >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="create-org-type" className="block text-sm font-medium text-text-primary mb-1">Type</label>
                <select
                  id="create-org-type"
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                >
                  <option value="university">University (school)</option>
                  <option value="firm">Firm</option>
                </select>
              </div>
              <div>
                <label htmlFor="create-org-name" className="block text-sm font-medium text-text-primary mb-1">Name</label>
                <input
                  id="create-org-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  onBlur={autoSlug}
                  placeholder="e.g. Wentworth Institute of Technology"
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="create-org-slug" className="block text-sm font-medium text-text-primary mb-1">Slug</label>
                <input
                  id="create-org-slug"
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="e.g. wit"
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
                <p className="text-xs text-text-secondary mt-1">Handoff link: /i/{form.slug || 'slug'}</p>
              </div>
              <div>
                <label htmlFor="create-org-network-label" className="block text-sm font-medium text-text-primary mb-1">
                  Network label <span className="font-normal text-text-dim">(optional)</span>
                </label>
                <input
                  id="create-org-network-label"
                  type="text"
                  value={form.network_label}
                  onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
                  placeholder="e.g. WIT Design Network"
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
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
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="min-h-11 flex-1 py-2 px-4 border border-border text-text-primary rounded-lg hover:bg-background font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-11 flex-1 py-2 px-4 bg-accent text-background-light rounded-lg hover:bg-accent-light disabled:opacity-50 font-medium text-sm"
                >
                  {loading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
      </Dialog>
    </div>
  )
}

function OrgRow({ inst, onEdit }: { inst: InstitutionWithCount; onEdit: (inst: InstitutionWithCount) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <li className="border-b border-border last:border-0">
      <div className="flex flex-col items-stretch gap-3 px-4 py-4 transition-colors hover:bg-primary-muted sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pinspace text-text-dim hover:bg-background-lighter hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={expanded ? 'Collapse' : 'Show studios'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 text-text-dim" />}
        </button>

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-primary truncate">{inst.name}</p>
          <p className="text-xs text-text-dim mt-0.5">
            /i/{inst.slug}
            {inst.domains?.length ? ` · ${inst.domains.join(', ')}` : ' · no domain restriction'}
          </p>
        </div>

        {/* Counts */}
        <div className="flex shrink-0 flex-wrap items-center gap-4">
          <span className="flex items-center gap-1 text-sm text-text-secondary whitespace-nowrap" title="Users">
            <Users className="w-4 h-4 text-text-dim" />
            {inst.user_count}
          </span>
          <span className="flex items-center gap-1 text-sm text-text-secondary whitespace-nowrap" title="Studio rooms">
            <LayoutGrid className="w-4 h-4 text-text-dim" />
            {inst.workspace_count}
          </span>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/admin/institutions/${inst.slug}`}
            className="inline-flex min-h-11 items-center rounded-pinspace px-3 py-2 text-xs font-medium text-accent hover:bg-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Full stats
          </Link>
          <button
            type="button"
            onClick={() => onEdit(inst)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pinspace text-text-dim hover:bg-background-lighter hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Edit"
            aria-label={`Edit ${inst.name}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <a
            href={`/i/${inst.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pinspace text-text-dim hover:bg-background-lighter hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Open explore"
            aria-label={`Open ${inst.name} explore page`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Expanded studio list */}
      {expanded && (
        <div className="px-6 pb-4 ml-10">
          {inst.workspaces.length === 0 ? (
            <p className="text-sm text-text-dim italic">No studio rooms yet</p>
          ) : (
            <ul className="space-y-1.5">
              {inst.workspaces.map((ws) => (
                <li key={ws.id} className="flex items-center justify-between text-sm text-text-secondary py-1 border-b border-border last:border-0">
                  <span className="font-medium text-text-primary">{ws.name || 'Unnamed'}</span>
                  <span className="text-xs text-text-dim">
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
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)

  // Domain management — fetched live on open
  const [domains, setDomains] = useState<{ id: string; domain: string }[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState('')
  const [domainAdding, setDomainAdding] = useState(false)
  const [domainRemoving, setDomainRemoving] = useState<string | null>(null)
  const mutationPending = loading || deleting || domainAdding || domainRemoving !== null

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
    if (mutationPending) return
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
    if (mutationPending) return
    setDomainError('')
    setDomainRemoving(domainId)
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
    } finally {
      setDomainRemoving(null)
    }
  }

  const handleDelete = async () => {
    if (mutationPending) return
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
    if (mutationPending) return
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
      onOpenChange={(next) => { if (!next && !mutationPending) onClose() }}
      closeOnOutsideClick={!mutationPending}
      hideCloseButton={mutationPending}
      title="Edit organization"
      description={`Update ${inst.name} without changing its existing access contract.`}
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="edit-org-type" className="block text-sm font-medium text-text-primary mb-1">Type</label>
            <select
              id="edit-org-type"
              value={form.type}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as 'university' | 'firm' }))}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
            >
              <option value="university">University (school)</option>
              <option value="firm">Firm</option>
            </select>
          </div>
          <div>
            <label htmlFor="edit-org-name" className="block text-sm font-medium text-text-primary mb-1">Name</label>
            <input
              id="edit-org-name"
              type="text"
              value={form.name}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="edit-org-slug" className="block text-sm font-medium text-text-primary mb-1">Slug</label>
            <input
              id="edit-org-slug"
              type="text"
              value={form.slug}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
            />
            <p className="text-xs text-text-secondary mt-1">Handoff link: /i/{form.slug || 'slug'}</p>
          </div>
          <div>
            <label htmlFor="edit-org-network-label" className="block text-sm font-medium text-text-primary mb-1">Network label <span className="font-normal text-text-dim">(optional)</span></label>
            <input
              id="edit-org-network-label"
              type="text"
              value={form.network_label}
              disabled={mutationPending}
              onChange={(e) => setForm((p) => ({ ...p, network_label: e.target.value }))}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="edit-org-domain" className="block text-sm font-medium text-text-primary mb-2">Allowed email domains</label>
            {domainsLoading ? (
              <p className="text-xs text-text-dim">Loading…</p>
            ) : (
              <>
                {domains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {domains.map((d) => (
                      <span key={d.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-muted text-accent rounded text-xs font-medium border border-accent">
                        {d.domain}
                        <button
                          type="button"
                          onClick={() => handleDomainRemove(d.id, d.domain)}
                          disabled={mutationPending}
                          aria-label={`Remove ${d.domain}`}
                          className="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-pinspace text-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { if (!mutationPending) onClose() }}
              disabled={mutationPending}
              className="min-h-11 flex-1 py-2 px-4 border border-border text-text-primary rounded-lg hover:bg-background font-medium text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutationPending}
              className="min-h-11 flex-1 py-2 px-4 bg-accent text-background-light rounded-lg hover:bg-accent-light disabled:opacity-50 font-medium text-sm"
            >
              {loading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        {/* Delete zone */}
        <div className="mt-5 pt-4 border-t border-border">
          {!confirmDelete ? (
            <button
              ref={deleteTriggerRef}
              type="button"
              onClick={beginDeleteConfirmation}
              disabled={mutationPending}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pinspace px-2 text-sm font-semibold text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              <Trash2 className="w-4 h-4" />
              Delete org
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-danger font-medium">Delete <span className="font-bold">{inst.name}</span>? This cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  ref={deleteCancelRef}
                  type="button"
                  onClick={cancelDeleteConfirmation}
                  disabled={mutationPending}
                  className="min-h-11 flex-1 py-2 px-3 border border-border text-text-primary rounded-lg hover:bg-background text-sm"
                >
                  Keep org
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={mutationPending}
                  className="min-h-11 flex-1 py-2 px-3 bg-danger text-background-light rounded-lg hover:bg-danger disabled:opacity-50 text-sm font-medium"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          )}
        </div>
    </Dialog>
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
  const [dataError, setDataError] = useState('')
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
    setDataError('')
    const fetchRequired = (url: string) => fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error('Failed to load administrative data')
      return response.json()
    })
    Promise.all([
      fetchRequired('/api/admin/overview'),
      fetchRequired('/api/admin/stats'),
      fetchRequired('/api/admin/recent-signups'),
      fetchRequired('/api/admin/studios'),
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
        setDataError('Failed to load administrative data')
        setInstitutions([])
        setRecentSignups([])
        setStudios([])
        setInstructors([])
        setInstructorsFailed(true)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // The request lifecycle intentionally owns the loading state for this admin view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent border-t-accent" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl bg-background-light p-8 shadow-xl border border-border">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary">PinSpace Admin</h1>
            <p className="text-sm text-text-secondary mt-1">Sign in with your admin email</p>
          </div>
          <form onSubmit={handleAdminSignIn} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-text-primary mb-1">Email</label>
              <input
                id="admin-email"
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@gmail.com"
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-text-primary mb-1">Password</label>
              <PasswordInput
                id="admin-password"
                value={signInPassword}
                onChange={setSignInPassword}
                autoComplete="current-password"
              />
            </div>
            {signInError && <p className="text-sm text-danger">{signInError}</p>}
            <button
              type="submit"
              disabled={signingIn}
              className="w-full py-2.5 bg-accent text-background-light rounded-lg hover:bg-accent-light disabled:opacity-50 font-medium"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Checking administrator access">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent border-t-transparent" />
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl bg-background-light p-8 shadow border border-border text-center">
          <h1 className="text-xl font-bold text-text-primary mb-2">Access denied</h1>
          <p className="text-text-secondary mb-6">This account is not in PINSPACE_ADMIN_EMAILS.</p>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="text-accent hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (dataError) {
    return (
      <AdminShell
        currentPath="/admin"
        title="Admin overview"
        description="Manage organizations, users, instructors, and studios."
        actions={
          <button
            type="button"
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="inline-flex min-h-11 items-center rounded-pinspace px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign out
          </button>
        }
      >
        <StatusState
          status="error"
          title={dataError}
          description="The request failed; no empty administrative state is being inferred."
          action={<Button type="button" variant="secondary" onClick={loadData}>Try again</Button>}
        />
      </AdminShell>
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
    <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h2 className="text-base font-semibold text-text-primary">{title}</h2>
            <p className="text-xs text-text-secondary">{description}</p>
          </div>
        </div>
        {/* Column headers */}
        {list.length > 0 && (
          <div className="hidden sm:flex items-center gap-5 mr-32 text-xs text-text-dim font-medium uppercase tracking-wide">
            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Users</span>
            <span className="flex items-center gap-1"><LayoutGrid className="w-3 h-3" /> Studios</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-accent mx-auto" />
        </div>
      ) : list.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">
          <p className="font-medium text-text-primary">{emptyMsg}</p>
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
    <AdminShell
      currentPath="/admin"
      title="Admin overview"
      description="Manage organizations, users, instructors, and studios."
      actions={<>
            <Link
              href="/admin/users"
              className="inline-flex min-h-11 items-center gap-2 rounded-pinspace border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Users className="w-4 h-4" />
              Users &amp; roles
            </Link>
            <CreateOrgForm onCreated={loadData} />
            <button
              onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
              className="inline-flex min-h-11 items-center rounded-pinspace px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          </>}
    >

        {/* Global student stats */}
        {stats && (
          <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden mb-6">
            <div className="px-6 py-3 border-b border-border bg-background flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-accent" />
              <h2 className="text-sm font-semibold text-text-primary">Global stats</h2>
              <span className="text-xs text-text-dim ml-1">{stats.total} profiles</span>
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
          <Building2 className="w-4 h-4 text-accent" />,
          'No institutions yet.'
        )}
        {renderOrgSection(
          firmsList,
          'Firms',
          'Architecture and design firms.',
          <Briefcase className="w-4 h-4 text-warning" />,
          'No firms yet.'
        )}

        <p className="text-xs text-text-dim text-center mt-2">
          User counts reflect profiles with <code>institution_id</code> set. Studio counts are workspaces linked to this org.
        </p>
      {editingInst && (
        <EditOrgModal
          inst={editingInst}
          onClose={() => setEditingInst(null)}
          onSaved={() => { setEditingInst(null); loadData() }}
        />
      )}
    </AdminShell>
  )
}
