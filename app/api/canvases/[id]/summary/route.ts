import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess, readCappedJson } from '@/lib/canvas/access'
import { MAX_SUMMARY_CHARS } from '@/lib/summary/types'

export const dynamic = 'force-dynamic'

// The current summary of one crit. One row per canvas, replaced on each save.
//
// Account holders only, like the transcript: a guest token grants marking up a
// board, not reading the conclusions drawn about someone's work.

const MISSING_TABLE_CODES = ['42P01', 'PGRST205']
const NOT_MIGRATED = 'Summaries need migration 040 applied to the database first.'

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && MISSING_TABLE_CODES.includes(code)
}

function transformSummary(row: Record<string, unknown>) {
  return {
    text: (row.text as string) ?? '',
    source: (row.source as string) ?? 'manual',
    updatedAt: row.updated_at as string,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await resolveCanvasAccess(request, (await params).id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (!result.access.authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabaseServiceRole()
      .from('canvas_summaries')
      .select('*')
      .eq('canvas_id', (await params).id)
      .maybeSingle()

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error fetching summary:', error)
      return NextResponse.json({ error: 'Failed to fetch the summary' }, { status: 500 })
    }

    // No summary yet is an ordinary state, not an error — most crits are in it.
    return NextResponse.json({ summary: data ? transformSummary(data) : null })
  } catch (err) {
    console.error('Unexpected error fetching summary:', err)
    return NextResponse.json({ error: 'Failed to fetch the summary' }, { status: 500 })
  }
}

// PUT — replace the summary.
//
// PUT rather than POST because there is at most one, and saving twice must not
// make two. The upsert conflicts on canvas_id, which migration 040 made the
// primary key precisely so this is a single statement rather than a
// read-then-branch that two tabs could both lose.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await resolveCanvasAccess(request, (await params).id)
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
    const { text, source } = parsed.body

    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    if (text.length > MAX_SUMMARY_CHARS) {
      return NextResponse.json(
        { error: `A summary must be under ${MAX_SUMMARY_CHARS} characters` },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseServiceRole()
      .from('canvas_summaries')
      .upsert(
        {
          canvas_id: (await params).id,
          text: text.trim(),
          source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 40) : 'manual',
          // updated_by: the upsert replaces the row, so this is the last writer
          // rather than the first. See migration 040.
          updated_by: access.authorId,
        },
        { onConflict: 'canvas_id' }
      )
      .select('*')
      .single()

    if (error || !data) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error saving summary:', error)
      return NextResponse.json({ error: 'Failed to save the summary' }, { status: 500 })
    }

    return NextResponse.json({ summary: transformSummary(data) })
  } catch (err) {
    console.error('Unexpected error saving summary:', err)
    return NextResponse.json({ error: 'Failed to save the summary' }, { status: 500 })
  }
}
