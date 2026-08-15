'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Archive,
  Building2,
  ExternalLink,
  GraduationCap,
  LogOut,
  MoreVertical,
  Network,
  Pencil,
  Plus,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
} from '@/components/ui'
import { useProfile } from '@/lib/ProfileContext'
import type { Workspace } from '@/types'

import type { Scope } from './DashboardSidebar'

export type DashboardWorkspace = Workspace & {
  owner_id?: string
  board_count?: number
  created_at?: string
  description?: string
  is_archived?: boolean
}

function withInstitution(path: string, slug: string | null): string {
  if (!slug) return path
  return `${path}${path.includes('?') ? '&' : '?'}institution=${encodeURIComponent(slug)}`
}

const interactiveLink =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-kova border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary shadow-[var(--shadow-soft)] transition-colors hover:border-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

interface ProjectCardProps {
  workspace: DashboardWorkspace
  isOwner: boolean
  scope: Scope
  institutionSlug: string | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
}

function ProjectCard({
  workspace,
  isOwner,
  scope,
  institutionSlug,
  onDelete,
  onRename,
  onLeave,
}: ProjectCardProps) {
  const isArchived = Boolean(workspace.is_archived)
  const Icon = scope === 'wentworth' ? GraduationCap : scope === 'shared' ? Users : Building2
  const projectName = workspace.name || 'Unnamed project'

  return (
    <Card
      className={`group relative overflow-visible p-0 transition-[transform,box-shadow] ${
        isArchived ? 'opacity-70' : 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]'
      }`}
    >
      <div className="relative flex h-32 items-center justify-center rounded-t-kova-lg bg-background-lighter">
        <Icon className="h-10 w-10 text-accent" aria-hidden="true" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {isArchived && (
            <Badge>
              <Archive className="mr-1 h-3 w-3" aria-hidden="true" />
              Archived
            </Badge>
          )}
          {isOwner && !isArchived && <Badge variant="accent">Owner</Badge>}
        </div>

        <Menu className="absolute right-2 top-2">
          <MenuTrigger
            aria-label={`Actions for ${projectName}`}
            className="min-h-11 min-w-11 border-border bg-background-light/95 p-0 text-text-secondary shadow-[var(--shadow-soft)] hover:text-text-primary"
          >
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </MenuTrigger>
          <MenuContent aria-label={`Actions for ${projectName}`}>
            {isOwner && (
              <Link
                role="menuitem"
                tabIndex={-1}
                href={withInstitution(`/workspace/${workspace.id}/settings`, institutionSlug)}
                className="flex min-h-10 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-text-primary hover:bg-background-lighter focus:bg-primary-muted focus:outline-none"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                Settings
              </Link>
            )}
            <MenuItem onSelect={() => onRename(workspace.id, workspace.name || '')}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Rename
            </MenuItem>
            {isOwner ? (
              <MenuItem
                onSelect={() => onDelete(workspace.id, workspace.name || '')}
                className="text-[rgb(var(--color-danger))] focus:bg-[rgb(var(--color-danger)/0.1)]"
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Delete
              </MenuItem>
            ) : (
              <MenuItem
                onSelect={() => onLeave(workspace.id, workspace.name || '')}
                className="text-[rgb(var(--color-danger))] focus:bg-[rgb(var(--color-danger)/0.1)]"
              >
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                Leave project
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>

      <Link
        href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)}
        className="block rounded-b-kova-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-text-primary">{projectName}</h2>
            <p className="mt-1 text-xs text-text-muted">
              {workspace.board_count !== undefined
                ? `${workspace.board_count} board${workspace.board_count === 1 ? '' : 's'}`
                : workspace.created_at
                  ? new Date(workspace.created_at).toLocaleDateString()
                  : 'Open project'}
            </p>
          </div>
          <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        </div>
      </Link>
    </Card>
  )
}

function ActionCard({ href, label, kind }: { href: string; label: string; kind: 'create' | 'network' }) {
  const Icon = kind === 'network' ? Network : Plus
  return (
    <Link
      href={href}
      className={`group flex min-h-48 flex-col items-center justify-center gap-3 rounded-kova-lg border p-5 text-center font-semibold shadow-[var(--shadow-soft)] transition-[transform,background-color,box-shadow] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        kind === 'network'
          ? 'border-accent bg-accent text-background-light hover:bg-accent-light'
          : 'border-dashed border-border bg-background-light text-text-primary hover:border-accent hover:bg-background-lighter'
      }`}
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${
        kind === 'network' ? 'bg-background-light/15' : 'bg-primary-muted'
      }`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      {label}
    </Link>
  )
}

interface ScopeConfig {
  title: string
  description: string
  newLabel: string
  newHref: string
  emptyTitle: string
  emptyDescription: string
  showJoin: boolean
}

function scopeConfig(
  scope: Scope,
  organization: { name: string; slug: string } | null,
  institutionHome: string | null,
  canCreate: boolean
): ScopeConfig {
  if (scope === 'wentworth') {
    return {
      title: organization?.name || 'Organization projects',
      description: 'Projects connected to your organization and its network.',
      newLabel: 'New Project',
      newHref: withInstitution('/workspace/new', institutionHome),
      emptyTitle: 'No organization projects yet',
      emptyDescription: canCreate ? 'Create a project or join with an invite code.' : 'Join with an invite code.',
      showJoin: true,
    }
  }
  if (scope === 'shared') {
    return {
      title: 'Shared Projects',
      description: 'Workspaces where you collaborate with other people.',
      newLabel: 'New Shared Project',
      newHref: '/workspace/new?type=shared',
      emptyTitle: 'No shared projects yet',
      emptyDescription: 'Create a shared project or join one with an invite code.',
      showJoin: true,
    }
  }
  return {
    title: 'Personal Projects',
    description: 'Private spaces for developing and organizing your work.',
    newLabel: 'New Personal Project',
    newHref: withInstitution('/studio/new', institutionHome),
    emptyTitle: 'No personal projects yet',
    emptyDescription: 'Create your first personal project to get started.',
    showJoin: false,
  }
}

interface DashboardMainProps {
  scope: Scope
  rooms: DashboardWorkspace[]
  userId: string | undefined
  institutionHome: string | null
  loading: boolean
  organization: { name: string; slug: string } | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
  onShowJoinModal: () => void
}

export function DashboardMain({
  scope,
  rooms,
  userId,
  institutionHome,
  loading,
  organization,
  onDelete,
  onRename,
  onLeave,
  onShowJoinModal,
}: DashboardMainProps) {
  const [archivedScope, setArchivedScope] = useState<Scope | null>(null)
  const { profile } = useProfile()
  const canCreate = scope !== 'wentworth' || profile.accountRole === 'instructor'
  const cfg = scopeConfig(scope, organization, institutionHome, canCreate)
  const hasArchived = rooms.some((room) => room.is_archived)
  const showArchived = archivedScope === scope
  const visibleRooms = showArchived ? rooms : rooms.filter((room) => !room.is_archived)
  const networkHref = scope === 'wentworth'
    ? organization?.slug ? `/explore?institution=${encodeURIComponent(organization.slug)}` : '/explore'
    : scope === 'shared' ? '/network/shared' : '/network'

  return (
    <main className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip" aria-labelledby="dashboard-title">
      <PageHeader
        title={<span id="dashboard-title">{cfg.title}</span>}
        description={cfg.description}
        className="pl-16 md:pl-8"
        actions={
          <>
            {hasArchived && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setArchivedScope((value) => value === scope ? null : scope)}
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                {showArchived ? 'Hide archived' : 'Show archived'}
              </Button>
            )}
            {cfg.showJoin && (
              <Button type="button" variant="ghost" onClick={onShowJoinModal}>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Join with code
              </Button>
            )}
            {canCreate && (
              <Link href={cfg.newHref} className={`${interactiveLink} border-kova-ink bg-primary hover:bg-primary-light`}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {cfg.newLabel}
              </Link>
            )}
          </>
        }
      />

      <div className="flex-1 bg-background px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div role="status" aria-label="Loading projects" className="space-y-4">
            <span className="sr-only">Loading projects</span>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {[0, 1, 2, 3].map((item) => (
                <Card key={item} className="overflow-hidden p-0">
                  <Skeleton className="h-32 rounded-none" />
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[96rem] space-y-8">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              <ActionCard href={networkHref} label="Enter Network" kind="network" />
              {canCreate && <ActionCard href={cfg.newHref} label={cfg.newLabel} kind="create" />}
              {visibleRooms.map((room) => (
                <ProjectCard
                  key={room.id}
                  workspace={room}
                  isOwner={room.owner_id === userId}
                  scope={scope}
                  institutionSlug={institutionHome}
                  onDelete={onDelete}
                  onRename={onRename}
                  onLeave={onLeave}
                />
              ))}
            </div>

            {visibleRooms.length === 0 && (
              <EmptyState
                title={cfg.emptyTitle}
                description={cfg.emptyDescription}
                icon={<Plus className="h-7 w-7" aria-hidden="true" />}
                action={
                  cfg.showJoin ? (
                    <Button type="button" variant="secondary" onClick={onShowJoinModal}>
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      Join with code
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}
      </div>
    </main>
  )
}
