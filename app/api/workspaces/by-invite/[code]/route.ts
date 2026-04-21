import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

function extractInviteCode(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      const parts = url.pathname.split('/').filter(Boolean)
      const joinIdx = parts.findIndex((p) => p.toLowerCase() === 'join')
      if (joinIdx >= 0 && parts[joinIdx + 1]) {
        return decodeURIComponent(parts[joinIdx + 1]).trim().toUpperCase()
      }
    }
  } catch {
    // Fall through to plain-code parsing.
  }
  return decodeURIComponent(trimmed).trim().toUpperCase()
}

// GET workspace by invite code (public endpoint for join page)
// Uses service role to bypass RLS since this is a public lookup
export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const supabase = supabaseServiceRole()
    const inviteCode = extractInviteCode(params.code || '')
    if (!inviteCode) {
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
    }

    // Fetch workspace by invite code (include institution for sign-in context)
    let { data: workspace, error } = await supabase
      .from('workspaces')
      .select('id, name, invite_code, institution_id')
      .eq('invite_code', inviteCode)
      .maybeSingle()

    // Backward compatibility: older workspaces may not have invite_code persisted.
    // Accept the same 8-char fallback shown in settings (workspace ID prefix).
    if (!workspace && inviteCode.length === 8) {
      const prefix = inviteCode.toLowerCase()
      const isHexPrefix = /^[0-9a-f]{8}$/i.test(prefix)

      if (isHexPrefix) {
        // UUID-safe prefix lookup (works when id column type is uuid).
        const lowerUuid = `${prefix}-0000-0000-0000-000000000000`
        const upperUuid = `${prefix}-ffff-ffff-ffff-ffffffffffff`
        const { data: uuidRows, error: uuidError } = await supabase
          .from('workspaces')
          .select('id, name, invite_code, institution_id')
          .gte('id', lowerUuid)
          .lte('id', upperUuid)
          .limit(1)

        if (!uuidError && uuidRows && uuidRows.length > 0) {
          workspace = uuidRows[0]
          error = null
        }
      }

      // Fallback for non-UUID id columns/environments.
      if (!workspace) {
        const { data: fallbackRows, error: fallbackError } = await supabase
          .from('workspaces')
          .select('id, name, invite_code, institution_id')
          .ilike('id', `${prefix}%`)
          .limit(1)
        if (!fallbackError && fallbackRows && fallbackRows.length > 0) {
          workspace = fallbackRows[0]
          error = null
        }
      }
    }

    if (error || !workspace) {
      console.error('Error finding workspace by invite code:', error)
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
    }

    // Get institution slug if workspace has institution
    let institutionSlug: string | null = null
    if (workspace.institution_id) {
      const { data: inst } = await supabase
        .from('institutions')
        .select('slug')
        .eq('id', workspace.institution_id)
        .single()
      if (inst?.slug) institutionSlug = inst.slug
    }

    // Get member count
    const { count: memberCount } = await supabase
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)

    // Return only public info (don't expose all members)
    return NextResponse.json({ 
      workspace: {
        id: workspace.id,
        name: workspace.name,
        inviteCode: workspace.invite_code,
        memberCount: memberCount || 0,
        institutionSlug: institutionSlug || undefined
      }
    })
  } catch (error) {
    console.error('Error finding workspace by invite:', error)
    return NextResponse.json({ error: 'Failed to find workspace' }, { status: 500 })
  }
}

