import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

export const dynamic = 'force-dynamic'

type PostgrestRpcError = {
  code: string
  message: string
  details?: string | null
  hint?: string | null
}

function mapRpcError(error: PostgrestRpcError): NextResponse {
  if (error.code === 'P0001') {
    if (error.message === 'already_processed') {
      return NextResponse.json({ error: 'This request was already processed' }, { status: 409 })
    }
    if (error.message === 'organization not found') {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }
    // Validation errors from RPC: 'name is required', 'slug is required', etc.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error.code === '23505') {
    if (error.message?.includes('org_domains_domain_unique')) {
      const match = error.details?.match(/Key \(domain\)=\(([^)]+)\)/)
      const conflicting = match?.[1] ?? 'a domain'
      return NextResponse.json(
        { error: `Domain ${conflicting} is already registered to another organization` },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'An organization with that slug already exists' }, { status: 409 })
  }
  return NextResponse.json({ error: 'Failed to approve request' }, { status: 500 })
}

/** PATCH /api/admin/org-requests/[id]/approve – approve via new org or existing org (admin only). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const mode = body?.mode

    if (mode !== 'new' && mode !== 'existing') {
      return NextResponse.json({ error: 'mode must be "new" or "existing"' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    if (mode === 'new') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const slug = typeof body.slug === 'string'
        ? body.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        : ''
      const type = body.type === 'firm' ? 'firm' : 'university'
      const networkLabel = typeof body.network_label === 'string' ? body.network_label.trim() || null : null

      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      if (!slug) return NextResponse.json({ error: 'Slug is required' }, { status: 400 })

      const { data, error } = await admin.rpc('approve_org_request_as_new_org', {
        p_request_id: id,
        p_name: name,
        p_slug: slug,
        p_type: type,
        p_network_label: networkLabel,
        p_decided_by: session.user.id,
      })

      if (error) {
        console.error('approve_org_request_as_new_org error:', error)
        return mapRpcError(error as PostgrestRpcError)
      }

      return NextResponse.json({ request: data })
    }

    // mode === 'existing'
    const orgId = typeof body.org_id === 'string' ? body.org_id.trim() : ''
    if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

    const { data, error } = await admin.rpc('approve_org_request_as_existing', {
      p_request_id: id,
      p_existing_org_id: orgId,
      p_decided_by: session.user.id,
    })

    if (error) {
      console.error('approve_org_request_as_existing error:', error)
      return mapRpcError(error as PostgrestRpcError)
    }

    return NextResponse.json({ request: data })
  } catch (e) {
    console.error('PATCH /api/admin/org-requests/[id]/approve:', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
