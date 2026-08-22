import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveRoomCanvasAccess, readCappedJson } from '@/lib/canvas/access'

export const dynamic = 'force-dynamic'

// Canvases within one space.
//
// Access is resolved by roomId — owner OR member OR superadmin — through the
// same helper the node routes use, so the collection and its contents cannot
// disagree about who may write. See lib/canvas/access.ts.

export interface CanvasSummary {
  id: string
  roomId: string
  title: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

function transformCanvas(row: Record<string, unknown>): CanvasSummary {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    title: (row.title as string) ?? '',
    createdBy: (row.created_by as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

// GET /api/canvases?roomId=... — canvases in one space, newest last.
export async function GET(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get('roomId')
    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 })
    }

    const result = await resolveRoomCanvasAccess(request, roomId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const { data, error } = await supabaseServiceRole()
      .from('canvases')
      .select('*')
      // Scoped to the ACCESS-CHECKED roomId, not the raw parameter — they are
      // the same string here, but reading it back off the resolved access keeps
      // that true if this ever gains a redirect or alias step.
      .eq('room_id', result.access.roomId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching canvases:', error)
      return NextResponse.json({ error: 'Failed to fetch canvases' }, { status: 500 })
    }

    return NextResponse.json({ canvases: (data || []).map(transformCanvas) })
  } catch (err) {
    console.error('Unexpected error fetching canvases:', err)
    return NextResponse.json({ error: 'Failed to fetch canvases' }, { status: 500 })
  }
}

// POST /api/canvases — create a canvas in a space.
export async function POST(request: NextRequest) {
  try {
    const parsed = await readCappedJson(request)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const { roomId, title } = parsed.body
    if (typeof roomId !== 'string' || !roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 })
    }

    const result = await resolveRoomCanvasAccess(request, roomId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result

    // Guests are deliberately excluded from CREATING canvases even when their
    // token carries canTrace. Drawing on a canvas someone put in front of you is
    // the guest critic's job; adding new surfaces to a space is structural, and
    // belongs to people with accounts in the workspace. A guest is exactly the
    // case where authorId is null.
    if (!access.canWrite || !access.authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const name = typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Untitled canvas'

    const { data, error } = await supabaseServiceRole()
      .from('canvases')
      .insert({
        room_id: access.roomId,
        title: name,
        created_by: access.authorId,
      })
      .select('*')
      .single()

    if (error || !data) {
      console.error('Error creating canvas:', error)
      return NextResponse.json({ error: 'Failed to create canvas' }, { status: 500 })
    }

    return NextResponse.json({ canvas: transformCanvas(data) })
  } catch (err) {
    console.error('Unexpected error creating canvas:', err)
    return NextResponse.json({ error: 'Failed to create canvas' }, { status: 500 })
  }
}
