import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveRoomCanvasAccess, resolveViewer, readCappedJson } from '@/lib/canvas/access'

export const dynamic = 'force-dynamic'

// The canvas collection, in two flavours.
//
//   ?roomId=...  — canvases inside one space. Access is owner OR member OR
//                  superadmin through the same helper the node routes use, so
//                  the collection and its contents cannot disagree about who
//                  may write.
//   no roomId    — YOUR desk crits. Personal canvases (migration 038), visible
//                  to their owner and nobody else.
//
// One route rather than two because the two lists are the same shape and the
// clients differ only in which anchor they hold. See lib/canvas/access.ts.

/** Cap on how many personal canvases one listing returns. */
const MAX_PERSONAL_CANVASES = 500

/**
 * Postgres `undefined_column`, which here means one thing: migration 038 has
 * not been applied yet.
 *
 * The personal branches cannot dodge naming owner_id the way resolveCanvasAccess
 * does — one filters on it and the other inserts it — so instead of a generic
 * 500 they say what is actually wrong. Migrations in this project are pasted by
 * hand, so this window is a normal state to be in, not a corrupt database.
 */
// TWO codes: `42703` is Postgres's own undefined_column, but PostgREST answers
// an insert naming an unknown column from its schema cache as `PGRST204`
// without reaching the database at all. Matching one would let the other fall
// through to the generic 500 this exists to replace.
const MISSING_COLUMN_CODES = ['42703', 'PGRST204']
const NOT_MIGRATED = 'Desk crits need migration 038 applied to the database first.'

function isMissingColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && MISSING_COLUMN_CODES.includes(code)
}

export interface CanvasSummary {
  id: string
  roomId: string | null
  ownerId: string | null
  title: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

function transformCanvas(row: Record<string, unknown>): CanvasSummary {
  return {
    id: row.id as string,
    roomId: (row.room_id as string) ?? null,
    ownerId: (row.owner_id as string) ?? null,
    title: (row.title as string) ?? '',
    createdBy: (row.created_by as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

// GET /api/canvases           — your desk crits, newest first.
// GET /api/canvases?roomId=…  — canvases in one space, oldest first.
export async function GET(request: NextRequest) {
  try {
    // An ABSENT roomId means "my desk crits". A PRESENT but empty one is a
    // caller bug — almost certainly a template that interpolated an undefined
    // id — and quietly answering it with someone's personal list would hide
    // that. POST refuses the same shape for the same reason.
    const roomParam = request.nextUrl.searchParams.get('roomId')
    if (roomParam !== null && !roomParam) {
      return NextResponse.json({ error: 'roomId must be a space id' }, { status: 400 })
    }
    const roomId = roomParam

    if (!roomId) {
      const viewer = await resolveViewer()
      if (!viewer.ok) {
        return NextResponse.json({ error: viewer.error }, { status: viewer.status })
      }

      const { data, error } = await supabaseServiceRole()
        .from('canvases')
        .select('*')
        // Filtered on owner_id, NOT created_by. They hold the same uid today,
        // but created_by is attribution and owner_id is the access anchor —
        // listing by the wrong one would be a permission check that happens to
        // agree rather than one that is right.
        .eq('owner_id', viewer.userId)
        // Newest first: a desk crit list is a reverse-chronological log, unlike
        // the room list below, where the oldest canvas is "the" canvas.
        .order('created_at', { ascending: false })
        .limit(MAX_PERSONAL_CANVASES)

      if (error) {
        if (isMissingColumn(error)) {
          return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
        }
        console.error('Error fetching personal canvases:', error)
        return NextResponse.json({ error: 'Failed to fetch canvases' }, { status: 500 })
      }

      const rows = data || []
      // Say so rather than quietly serving a partial list — the same
      // silent-truncation trap the node reader logs at its own ceiling.
      if (rows.length >= MAX_PERSONAL_CANVASES) {
        console.warn(
          `User ${viewer.userId} hit the ${MAX_PERSONAL_CANVASES}-canvas listing cap; result is partial`
        )
      }

      return NextResponse.json({ canvases: rows.map(transformCanvas) })
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

// POST /api/canvases — create a canvas.
//
// With a roomId, it goes in that space. Without one, it is a personal desk
// crit owned by the caller. Migration 038's CHECK enforces exactly one anchor,
// so the two branches below cannot both apply.
export async function POST(request: NextRequest) {
  try {
    const parsed = await readCappedJson(request)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const { roomId, title } = parsed.body

    if (roomId !== undefined && (typeof roomId !== 'string' || !roomId)) {
      return NextResponse.json({ error: 'roomId must be a space id' }, { status: 400 })
    }

    const name = typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Untitled crit'

    if (!roomId) {
      const viewer = await resolveViewer()
      if (!viewer.ok) {
        return NextResponse.json({ error: viewer.error }, { status: viewer.status })
      }

      const { data, error } = await supabaseServiceRole()
        .from('canvases')
        .insert({
          room_id: null,
          owner_id: viewer.userId,
          title: name,
          created_by: viewer.userId,
        })
        .select('*')
        .single()

      if (error || !data) {
        if (isMissingColumn(error)) {
          return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
        }
        console.error('Error creating personal canvas:', error)
        return NextResponse.json({ error: 'Failed to create canvas' }, { status: 500 })
      }

      return NextResponse.json({ canvas: transformCanvas(data) })
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

    const { data, error } = await supabaseServiceRole()
      .from('canvases')
      .insert({
        room_id: access.roomId,
        // owner_id is deliberately OMITTED rather than set to null. The column
        // arrives with migration 038 and migrations here are applied by hand,
        // so naming it would make creating a room canvas fail with 42703 in the
        // window before that paste — breaking a surface that already shipped.
        // Omitted, the column defaults to NULL once it exists, which is the
        // same result.
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
