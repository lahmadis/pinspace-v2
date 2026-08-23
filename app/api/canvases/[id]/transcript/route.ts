import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess, readCappedJson } from '@/lib/canvas/access'
import { TRANSCRIPTION_SOURCES } from '@/lib/transcription/types'

export const dynamic = 'force-dynamic'

// The spoken record of one crit: segments, in the order they were said.
//
// Access is resolveCanvasAccess, the same resolver the nodes use — so a
// personal crit's transcript is readable only by its owner, and a guest with a
// canTrace token on a room canvas can neither read nor write one. That last
// part is deliberate: marking up someone's board is not the same permission as
// reading a recording of the conversation around it.

/** Matches the CHECK in migration 039. Enforced here so it's a 400, not a 500. */
const MAX_SEGMENT_CHARS = 100000
/** Segments returned in one read. A crit of ~200 segments is already extreme. */
const MAX_SEGMENTS = 2000

/**
 * "This table doesn't exist" — which here means migration 039 is not applied.
 *
 * TWO codes, not one. `42P01` is Postgres's own undefined_table, but PostgREST
 * usually answers first from its schema cache and returns `PGRST205` without
 * ever reaching the database. Matching only the Postgres code would leave the
 * common case falling through to a generic 500, which is exactly the unhelpful
 * answer this check exists to replace.
 */
const MISSING_TABLE_CODES = ['42P01', 'PGRST205']
const NOT_MIGRATED = 'Voice notes need migration 039 applied to the database first.'

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && MISSING_TABLE_CODES.includes(code)
}

/**
 * How far back a client-supplied `recordedAt` may reach.
 *
 * recorded_at is the SORT KEY for the whole transcript, so an unbounded value
 * is not merely wrong data — a skewed clock or a year-9999 stamp permanently
 * reorders the record of a crit, and nothing in the UI would explain why. A
 * segment always describes speech from the current session, so anything
 * outside this window is a bug or a lie and gets clamped to now.
 */
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000
/**
 * Forward tolerance, for a client clock that is merely a little fast.
 *
 * Rejecting every future stamp would throw away a correct segment start over a
 * few seconds of ordinary clock drift — which is not the problem the clamp is
 * for. The problem is a stamp years out that permanently reorders the record.
 */
const MAX_FUTURE_SKEW_MS = 60 * 1000

interface TranscriptSegment {
  id: string
  text: string
  source: string
  recordedAt: string
}

function transformSegment(row: Record<string, unknown>): TranscriptSegment {
  return {
    id: row.id as string,
    text: (row.text as string) ?? '',
    source: (row.source as string) ?? 'web-speech',
    recordedAt: row.recorded_at as string,
  }
}

// GET — every segment of this crit, oldest first.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await resolveCanvasAccess(request, params.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    // A guest token grants drawing, never listening. authorId is null exactly
    // for guests, which is the cheapest way to say "account holders only".
    if (!result.access.authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Ordered DESC to apply the cap, then reversed for display.
    //
    // Ascending would keep the OLDEST segments and silently drop the newest —
    // so a long crit would lose the end of the conversation on reload, which is
    // both the most recent and usually the most useful part. Truncating from
    // the far end is the right direction for a running record.
    const { data, error } = await supabaseServiceRole()
      .from('canvas_transcripts')
      .select('*')
      .eq('canvas_id', params.id)
      .order('recorded_at', { ascending: false })
      // Total, so two segments sharing a timestamp — an autosave and a beacon
      // landing together — do not swap places between loads. Same reason the
      // node reader breaks its z ties on id.
      .order('id', { ascending: false })
      .limit(MAX_SEGMENTS)

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error fetching transcript:', error)
      return NextResponse.json({ error: 'Failed to fetch the transcript' }, { status: 500 })
    }

    const rows = data || []
    if (rows.length >= MAX_SEGMENTS) {
      console.warn(
        `Canvas ${params.id} hit the ${MAX_SEGMENTS}-segment read cap; the oldest segments are omitted`
      )
    }

    // Back into spoken order for the reader.
    return NextResponse.json({ segments: rows.reverse().map(transformSegment) })
  } catch (err) {
    console.error('Unexpected error fetching transcript:', err)
    return NextResponse.json({ error: 'Failed to fetch the transcript' }, { status: 500 })
  }
}

// POST — append one segment.
//
// Insert-only, never an update to a growing blob. See migration 039's header:
// a read-modify-write on one text column silently loses speech when two writes
// overlap, and losing part of the record is the failure this table exists to
// prevent.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await resolveCanvasAccess(request, params.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    if (!access.canWrite || !access.authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = await readCappedJson(request)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const { text, source, recordedAt } = parsed.body

    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    if (text.length > MAX_SEGMENT_CHARS) {
      return NextResponse.json(
        { error: `text must be under ${MAX_SEGMENT_CHARS} characters` },
        { status: 400 }
      )
    }
    // Rejected rather than defaulted: an unrecognised source means the caller
    // and this route disagree about what produced the text, and silently
    // relabelling it 'web-speech' would put a false provenance on the record.
    if (source !== undefined && !(TRANSCRIPTION_SOURCES as readonly string[]).includes(source as string)) {
      return NextResponse.json(
        { error: `source must be one of ${TRANSCRIPTION_SOURCES.join(', ')}` },
        { status: 400 }
      )
    }
    // The client supplies this because it knows when the speech STARTED; the
    // row is written when it stopped. Parsed AND bounded — see MAX_BACKDATE_MS:
    // this column orders the transcript, so an unparseable value or one from a
    // badly skewed clock would silently shuffle the record rather than just
    // mislabel one segment. Clamped rather than rejected, because the text is
    // worth keeping even when its timestamp isn't.
    const now = Date.now()
    let stamp = new Date(now).toISOString()
    if (typeof recordedAt === 'string') {
      const parsedMs = new Date(recordedAt).getTime()
      if (
        !Number.isNaN(parsedMs) &&
        parsedMs <= now + MAX_FUTURE_SKEW_MS &&
        parsedMs >= now - MAX_BACKDATE_MS
      ) {
        stamp = new Date(parsedMs).toISOString()
      }
    }

    const { data, error } = await supabaseServiceRole()
      .from('canvas_transcripts')
      .insert({
        canvas_id: params.id,
        text: text.trim(),
        source: (source as string) ?? 'web-speech',
        recorded_at: stamp,
        created_by: access.authorId,
      })
      .select('*')
      .single()

    if (error || !data) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error saving transcript segment:', error)
      return NextResponse.json({ error: 'Failed to save what was said' }, { status: 500 })
    }

    return NextResponse.json({ segment: transformSegment(data) })
  } catch (err) {
    console.error('Unexpected error saving transcript segment:', err)
    return NextResponse.json({ error: 'Failed to save what was said' }, { status: 500 })
  }
}
