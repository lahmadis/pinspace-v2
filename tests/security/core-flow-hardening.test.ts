import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeInviteCode, workspaceInviteMatches } from '@/lib/workspaces/inviteCodes'
import {
  feedbackSubmitterIdentifier,
  parseFeedbackPayload,
  submitterHash,
} from '@/lib/feedback/security'
import { generateInviteCode } from '@/lib/workspaceUtils'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('workspace invite capabilities', () => {
  it('normalizes invite codes without accepting workspace ids as fallbacks', () => {
    expect(normalizeInviteCode('  ab12-cd34  ')).toBe('AB12-CD34')
    expect(normalizeInviteCode('')).toBe('')
  })

  it('requires an exact stored capability and rejects personal workspaces', () => {
    expect(workspaceInviteMatches('class', 'AB12CD34', 'ab12cd34')).toBe(true)
    expect(workspaceInviteMatches('shared', 'AB12CD34', 'AB12CD34')).toBe(true)
    expect(workspaceInviteMatches('personal', 'AB12CD34', 'AB12CD34')).toBe(false)
    expect(workspaceInviteMatches('shared', null, 'AB12CD34')).toBe(false)
    expect(workspaceInviteMatches('shared', 'AB12CD34', 'WRONG')).toBe(false)
  })

  it('generates high-entropy URL-safe invite capabilities', () => {
    const codes = Array.from({ length: 32 }, () => generateInviteCode())
    expect(new Set(codes)).toHaveLength(codes.length)
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{20}$/)
    expect(read('lib/workspaceUtils.ts')).not.toContain('Math.random()')
  })

  it('passes the invite capability from the join page to the mutation route', () => {
    const page = read('app/join/[code]/page.tsx')
    const route = read('app/api/workspaces/[id]/join/route.ts')
    const workspaceRoute = read('app/api/workspaces/[id]/route.ts')

    expect(page).toContain('inviteCode,')
    expect(route).toContain('workspaceInviteMatches(')
    expect(route).toContain("workspace.type === 'personal'")
    expect(workspaceRoute).not.toContain('canJoin: true')
    expect(workspaceRoute).toContain('inviteCode: isOwner ? workspace.invite_code || undefined : undefined')
  })
})

describe('profile privilege boundaries', () => {
  it('protects privileged profile columns on insert and update', () => {
    const migration = read('migrations/037_harden_profile_roles_and_invites.sql')

    expect(migration).toContain('BEFORE INSERT OR UPDATE ON public.user_profiles')
    expect(migration).toContain('account_role')
    expect(migration).toContain('is_superadmin')
    expect(migration).toContain('organization_id')
    expect(migration).toContain('auth.role()')
    expect(migration).toContain("invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24))")

    const verification = read('scripts/verify-profile-privilege-boundary.sql')
    expect(verification).toContain('SET LOCAL ROLE authenticated')
    expect(verification).toContain('WHEN insufficient_privilege')
    expect(verification).toContain('ROLLBACK;')
  })
})

describe('workspace, room, and board authority boundaries', () => {
  it('derives class organization membership from the verified profile', () => {
    const route = read('app/api/workspaces/route.ts')

    expect(route).toContain(".select('organization_id, account_role')")
    expect(route).toContain("organizationId: type === 'class' ? profile?.organization_id ?? null : null")
    expect(route).not.toContain('institutionIdFromBody')
    expect(route).not.toContain('institutionSlugFromBody')
  })

  it('ships an unapplied database boundary for direct browser mutations', () => {
    const migration = read('migrations/039_harden_workspace_room_board_authority.sql')

    expect(migration).toContain('workspace_authority_columns_are_server_managed')
    expect(migration).toContain('NEW.owner_id IS DISTINCT FROM OLD.owner_id')
    expect(migration).toContain('NEW.organization_id IS DISTINCT FROM OLD.organization_id')
    expect(migration).toContain('NEW.type IS DISTINCT FROM OLD.type')
    expect(migration).toContain("owner_account_role IS DISTINCT FROM 'instructor'")
    expect(migration).toContain('NEW.organization_id IS DISTINCT FROM owner_organization_id')
    expect(migration).toContain("coalesce(NEW.type, 'class') <> 'class' AND NEW.organization_id IS NOT NULL")
    expect(migration).toContain('NEW.is_public IS DISTINCT FROM false')
    expect(migration).toContain('NEW.is_public IS DISTINCT FROM OLD.is_public')
    expect(migration).toContain('NEW.published_at IS DISTINCT FROM OLD.published_at')

    expect(migration).toContain('room_publication_columns_are_server_managed')
    expect(migration).toContain('NEW.is_published IS DISTINCT FROM OLD.is_published')
    expect(migration).not.toContain('NEW.is_globally_public')
    expect(migration).not.toContain('OLD.is_globally_public')
    expect(migration).toContain('NEW.published_at IS DISTINCT FROM OLD.published_at')

    expect(migration).toContain('board_parent_columns_are_server_managed')
    expect(migration).toContain('NEW.workspace_id IS DISTINCT FROM OLD.workspace_id')
    expect(migration).toContain('NEW.room_id IS DISTINCT FROM OLD.room_id')
    expect(migration).toContain('r.workspace_id = NEW.workspace_id')
    expect(migration).toContain('wm.user_id = auth.uid()::text')
    expect(migration).toContain('ordinary board title and position updates remain allowed')

    const roomRoute = read('app/api/rooms/[id]/route.ts')
    expect(roomRoute).toContain(".select('owner_id, type, organization_id')")
    expect(roomRoute).toContain("workspace.type !== 'class'")
    expect(roomRoute).toContain('profile.organization_id !== workspace.organization_id')

    const verification = read('scripts/verify-workspace-room-board-authority.sql')
    expect(verification).toContain("'Migration 039 shared org check', auth.uid()::text, 'shared'")
    expect(verification).toContain("'Migration 039 personal org check', auth.uid()::text, 'personal'")
    expect(verification).toContain('SET is_public = NOT is_public')
    expect(verification).toContain('direct legacy workspace publication update denied')
    expect(verification).toContain("'Migration 039 room insert check'")
    expect(verification).toContain("SET name = 'Migration 039 renamed room', display_order = 1")
    expect(verification).toContain('ordinary room insert and name/order update accepted')
    expect(verification).toContain('SET is_published = true')
    expect(verification).toContain('direct room is_published update denied')
    expect(verification).toContain('SET published_at = now()')
    expect(verification).toContain('direct room published_at update denied')
  })
})

describe('feedback abuse controls', () => {
  it('bounds accepted payloads and page URLs', () => {
    expect(parseFeedbackPayload({ message: ' Useful idea ', page_url: '/studio/1' })).toEqual({
      ok: true,
      message: 'Useful idea',
      pageUrl: '/studio/1',
    })
    expect(parseFeedbackPayload({ message: '' })).toEqual({ ok: false, error: 'Message is required' })
    expect(parseFeedbackPayload({ message: 'x'.repeat(4001) })).toEqual({
      ok: false,
      error: 'Message must be 4000 characters or fewer',
    })
    expect(parseFeedbackPayload({ message: 'ok', page_url: 'javascript:alert(1)' })).toEqual({
      ok: false,
      error: 'Page URL must be a local path or an HTTP(S) URL',
    })
    expect(parseFeedbackPayload({ message: 'ok', page_url: '/studio/1\nInjected: value' })).toEqual({
      ok: false,
      error: 'Page URL must be a local path or an HTTP(S) URL',
    })
  })

  it('hashes submitter identifiers without retaining raw addresses', () => {
    const hash = submitterHash('ip:203.0.113.9', 'server-secret')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain('203.0.113.9')
    expect(hash).toBe(submitterHash('ip:203.0.113.9', 'server-secret'))
  })

  it('trusts only the platform-owned anonymous client address', () => {
    const spoofed = new Request('https://pinspace.test/api/feedback', {
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.10' },
    })
    expect(feedbackSubmitterIdentifier(spoofed, null)).toBe('ip:unknown')

    const vercel = new Request('https://pinspace.test/api/feedback', {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        'x-vercel-forwarded-for': '198.51.100.8',
      },
    })
    expect(feedbackSubmitterIdentifier(vercel, null)).toBe('ip:198.51.100.8')
    expect(feedbackSubmitterIdentifier(spoofed, 'user-123')).toBe('user:user-123')
  })

  it('uses the atomic database submission boundary', () => {
    const route = read('app/api/feedback/route.ts')
    const migration = read('migrations/038_rate_limit_feedback.sql')

    expect(route).toContain(".rpc('submit_feedback'")
    expect(route).toContain("status: 429")
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('feedback_rate_limited')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.submit_feedback')
  })
})
