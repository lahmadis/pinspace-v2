import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/users/[id]/boards — public boards uploaded by a user (across public studios only)
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = supabaseServiceRole()
    const userId = params.id

    // Get all boards by this user
    const { data: boards, error } = await admin
      .from('boards')
      .select('*, workspaces!inner(id, name, is_public, published_at, network_metadata, academic_year)')
      .eq('owner_id', userId)
      .eq('workspaces.is_public', true)
      .not('workspaces.published_at', 'is', null)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Error fetching user boards:', error)
      return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
    }

    // Also get user profile for display name
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, major, year, role')
      .eq('user_id', userId)
      .maybeSingle()

    const transformed = (boards || []).map((b) => ({
      id: b.id,
      title: b.title,
      thumbnailUrl: b.thumbnail_url,
      fullImageUrl: b.full_image_url,
      uploadedAt: b.uploaded_at,
      tags: b.tags || [],
      studioId: b.workspace_id,
      studioName: (b.workspaces as { name: string })?.name,
      networkMetadata: (b.workspaces as { network_metadata: unknown })?.network_metadata,
      academicYear: (b.workspaces as { academic_year: string })?.academic_year,
      aspectRatio: b.aspect_ratio ? parseFloat(b.aspect_ratio) : undefined,
    }))

    return NextResponse.json({
      boards: transformed,
      profile: profile || null,
      ownerName: boards?.[0]?.owner_name || null,
    })
  } catch (error) {
    console.error('Error fetching user portfolio:', error)
    return NextResponse.json({ error: 'Failed to fetch portfolio' }, { status: 500 })
  }
}
