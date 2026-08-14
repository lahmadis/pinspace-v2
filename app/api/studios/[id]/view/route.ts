import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST /api/studios/[id]/view — increment view counter for a public studio
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const admin = supabaseServiceRole()

    // Only count views for public, published studios
    const { data: workspace } = await admin
      .from('workspaces')
      .select('is_public, published_at')
      .eq('id', id)
      .single()

    if (!workspace?.is_public || !workspace?.published_at) {
      return NextResponse.json({ ok: false })
    }

    await admin.rpc('increment_view_count', { workspace_id: id })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
