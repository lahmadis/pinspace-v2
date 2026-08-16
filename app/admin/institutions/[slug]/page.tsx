'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink, Users, LayoutGrid, Image as ImageIcon } from 'lucide-react'
import { useAuthSession } from '@/hooks/useAuthSession'
import { AdminShell } from '@/components/admin/AdminShell'
import {
  Badge,
  ButtonLink,
  Card,
  DataTable,
  Spinner,
  StatusState,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableStateRow,
} from '@/components/ui'

type UserRole = 'faculty' | 'student' | 'professional'

function roleDisplayLabel(role: UserRole): string {
  switch (role) {
    case 'faculty':
      return 'Professor'
    case 'student':
      return 'Student'
    case 'professional':
      return 'Professional working at a firm'
    default:
      return role
  }
}

type InstitutionStats = {
  institution: { id: string; name: string; slug: string; network_label?: string; allowed_email_domains?: string }
  summary: { total_users: number; faculty_count: number; student_count: number; professional_count?: number; studio_count: number; board_count: number }
  users: Array<{
    id: string
    email: string
    full_name: string
    role: UserRole
    major?: string
    year?: string
    age_range?: string
    created_at?: string
  }>
  studios: Array<{ id: string; name: string; owner_id: string; type?: string; created_at?: string }>
}

export default function InstitutionStatsPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params?.slug as string
  const { status: authStatus, user } = useAuthSession()
  const isLoaded = authStatus !== 'loading'
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [stats, setStats] = useState<InstitutionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/sign-in')
    }
  }, [authStatus, router])

  useEffect(() => {
    if (!isLoaded || !user?.id) return
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [isLoaded, user?.id])

  useEffect(() => {
    if (!isAdmin || !slug) return
    // The request lifecycle intentionally owns loading and error state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    fetch(`/api/admin/institutions/${encodeURIComponent(slug)}/stats`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Institution not found' : 'Failed to load')
        return r.json()
      })
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAdmin, slug])

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Loading administrator session">
        <Spinner className="h-12 w-12 text-accent" aria-hidden="true" />
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl bg-background-light p-8 shadow border border-border text-center">
          <h1 className="text-xl font-bold text-text-primary mb-2">Access denied</h1>
          <p className="text-text-secondary mb-6">Only admins can view institution stats.</p>
          <Link href="/dashboard" className="text-accent hover:underline">← Back to Dashboard</Link>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-6">
        <StatusState
          status="error"
          title="Could not load institution"
          description={error}
          action={<Link href="/admin" className="inline-flex min-h-11 items-center rounded-pinspace px-3 text-sm font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Back to admin</Link>}
        />
      </main>
    )
  }

  if (loading || !stats) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status">
        <div className="text-center">
          <Spinner className="mb-4 h-12 w-12 text-accent" aria-hidden="true" />
          <p className="text-text-secondary">Loading…</p>
        </div>
      </div>
    )
  }

  const { institution, summary, users, studios } = stats

  return (
    <AdminShell
      currentPath={`/admin/institutions/${institution.slug}`}
      title={institution.name}
      description={`${institution.slug}${institution.network_label ? ` · ${institution.network_label}` : ''}`}
      actions={
          <ButtonLink
            href={`/i/${institution.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open explore <ExternalLink className="w-4 h-4" />
          </ButtonLink>
      }
    >

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-8">
          <Card>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <Users className="w-5 h-5" />
              <span className="text-sm font-medium">Total users</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{summary.total_users}</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <span className="text-sm font-medium">Faculty</span>
            </div>
            <p className="text-2xl font-bold text-accent">{summary.faculty_count}</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <span className="text-sm font-medium">Students</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{summary.student_count}</p>
          </Card>
          {(summary.professional_count ?? 0) > 0 && (
            <Card>
              <div className="flex items-center gap-2 text-text-secondary mb-1">
                <span className="text-sm font-medium">Professionals</span>
              </div>
              <p className="text-2xl font-bold text-warning">{summary.professional_count}</p>
            </Card>
          )}
          <Card>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <LayoutGrid className="w-5 h-5" />
              <span className="text-sm font-medium">Studios</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{summary.studio_count}</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <ImageIcon className="w-5 h-5" />
              <span className="text-sm font-medium">Boards</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{summary.board_count}</p>
          </Card>
        </div>

        <Card className="mb-8 overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-border bg-background">
            <h2 className="text-lg font-semibold text-text-primary">Student stats</h2>
            <p className="text-sm text-text-secondary">Name, email, and role (Student, Professor, or Professional working at a firm)</p>
          </div>
          <DataTable label="Institution users">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Major</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Age range</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableStateRow colSpan={7} status="empty" title="No users yet for this institution" />
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.full_name}</TableCell>
                      <TableCell className="text-text-secondary">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === 'faculty' ? 'accent' : u.role === 'professional' ? 'warning' : 'neutral'}>
                          {roleDisplayLabel(u.role)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-text-secondary">{u.major || '—'}</TableCell>
                      <TableCell className="text-text-secondary">{u.year || '—'}</TableCell>
                      <TableCell className="text-text-secondary">{u.age_range || '—'}</TableCell>
                      <TableCell className="text-text-secondary">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
          </DataTable>
        </Card>

        <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-background">
            <h2 className="text-lg font-semibold text-text-primary">Studio spaces</h2>
            <p className="text-sm text-text-secondary">Workspaces created for this institution</p>
          </div>
          {studios.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">No studios yet</div>
          ) : (
            <ul className="divide-y divide-border">
              {studios.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-6 py-3 hover:bg-background/50">
                  <span className="font-medium text-text-primary">{s.name || 'Unnamed'}</span>
                  <span className="text-sm text-text-secondary">
                    {s.type || 'class'} · {s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
    </AdminShell>
  )
}
