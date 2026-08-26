import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

/** PATCH /api/admin/institutions/[slug] – update an institution (admin only). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 })
    }

    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined
    const newSlug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : undefined
    const networkLabel = typeof body?.network_label === 'string' ? body.network_label.trim() || null : undefined
    const type = body?.type === 'firm' ? 'firm' : body?.type === 'university' ? 'university' : undefined

    const admin = supabaseServiceRole()

    const { data: institution, error: instErr } = await admin
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single()

    if (instErr || !institution) {
      return NextResponse.json({ error: 'Institution not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (newSlug !== undefined) updates.slug = newSlug
    if (networkLabel !== undefined) updates.network_label = networkLabel
    if (type !== undefined) updates.type = type

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data: updated, error: updateErr } = await admin
      .from('organizations')
      .update(updates)
      .eq('id', institution.id)
      .select('id, name, slug, network_label, type')
      .single()

    if (updateErr) {
      if (updateErr.code === '23505') {
        return NextResponse.json({ error: 'An institution with this slug already exists' }, { status: 409 })
      }
      console.error('Error updating institution:', updateErr)
      return NextResponse.json({ error: 'Failed to update institution' }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error in PATCH /api/admin/institutions/[slug]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** DELETE /api/admin/institutions/[slug] – remove an institution (admin only). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 })
    }

    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()

    const { data: institution, error: instErr } = await admin
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single()

    if (instErr || !institution) {
      return NextResponse.json({ error: 'Institution not found' }, { status: 404 })
    }

    const institutionId = institution.id

    // Detach from workspaces first (avoid FK errors)
    await admin
      .from('workspaces')
      .update({ organization_id: null })
      .eq('organization_id', institutionId)

    const { error: delErr } = await admin
      .from('organizations')
      .delete()
      .eq('id', institutionId)

    if (delErr) {
      console.error('Error deleting institution:', delErr)
      return NextResponse.json({ error: 'Failed to delete institution' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/admin/institutions/[slug]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
