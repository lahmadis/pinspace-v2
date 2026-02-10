import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

function getAllowedDomains(domainsStr: string | null | undefined): string[] {
  if (!domainsStr || !domainsStr.trim()) return []
  return domainsStr
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

function userEmailDomainAllowed(userEmail: string | undefined, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  if (!userEmail || !userEmail.includes('@')) return false
  const domain = userEmail.split('@')[1]?.trim().toLowerCase()
  if (!domain) return false
  return allowedDomains.includes(domain)
}

// JOIN workspace - Add user to workspace_members table. Enforces institution email domain when set.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }

    const userId = session?.user?.id
    const userEmail = session?.user?.email
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { userName } = body
    const workspaceId = params.id

    if (!userName) {
      return NextResponse.json({ error: 'User name required' }, { status: 400 })
    }

    // Fetch workspace and its institution (use service role so we can read institution for non-members)
    const admin = supabaseServiceRole()
    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces')
      .select('id, name, institution_id')
      .eq('id', workspaceId)
      .single()

    if (workspaceError || !workspace) {
      console.error('Error fetching workspace:', workspaceError)
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // If workspace has an institution with allowed_email_domains, enforce domain
    if (workspace.institution_id) {
      const { data: institution, error: instError } = await admin
        .from('institutions')
        .select('name, allowed_email_domains')
        .eq('id', workspace.institution_id)
        .single()
      if (!instError && institution?.allowed_email_domains) {
        const allowed = getAllowedDomains(institution.allowed_email_domains)
        if (allowed.length > 0 && !userEmailDomainAllowed(userEmail, allowed)) {
          const domainList = allowed.map((d) => `@${d}`).join(' or ')
          return NextResponse.json(
            {
              error: 'Email domain not allowed',
              message: `You can only join this workspace with a ${institution.name} email (e.g. ${domainList}). Sign in with your school email and try again.`,
            },
            { status: 403 }
          )
        }
      }
    }

    // Check if already a member (use admin so we can read before membership exists)
    const { data: existingMember } = await admin
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single()

    if (existingMember) {
      console.log('✅ User already a member of workspace:', workspaceId)
      return NextResponse.json({ 
        success: true, 
        workspace: {
          id: workspace.id,
          name: workspace.name,
        },
        alreadyMember: true 
      })
    }

    // Add user as student member (use admin so insert succeeds after domain check)
    const { data: newMember, error: insertError } = await admin
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        name: userName,
        role: 'student',
        joined_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error adding member to workspace:', insertError)
      return NextResponse.json({ 
        error: 'Failed to join workspace', 
        details: insertError.message || insertError 
      }, { status: 500 })
    }

    console.log('✅ [API] User joined workspace:', userId, '→', workspaceId)
    return NextResponse.json({ 
      success: true, 
      workspace: {
        id: workspace.id,
        name: workspace.name,
      }
    })
  } catch (error) {
    console.error('Error joining workspace:', error)
    return NextResponse.json({ 
      error: 'Failed to join workspace', 
      details: (error as Error).message 
    }, { status: 500 })
  }
}

