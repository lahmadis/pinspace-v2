import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess, readCappedJson } from '@/lib/canvas/access'
import {
  MAX_DELIVERABLES,
  MAX_DELIVERABLE_DETAIL,
  MAX_DELIVERABLE_DUE,
  MAX_DELIVERABLE_TITLE,
} from '@/lib/summary/types'

export const dynamic = 'force-dynamic'

// Things to do, extracted from a crit. List and create.
//
// POST takes an ARRAY, because the thing that creates these is a summarise
// step that produces the whole list at once. One request per item would mean a
// half-inserted list when the fourth of six fails, and no way to tell the user
// which four landed.

const MISSING_TABLE_CODES = ['42P01', 'PGRST205']
const NOT_MIGRATED = 'Deliverables need migration 040 applied to the database first.'

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && MISSING_TABLE_CODES.includes(code)
}

/**
 * Hard ceiling on how many one canvas may hold, across all extractions.
 *
 * Enforced on BOTH verbs: the reader caps its result, and POST refuses a batch
 * that would cross it. A read-only cap would let writes build a list longer
 * than anything can display.
 */
const MAX_TOTAL_DELIVERABLES = 500

interface DeliverableRow {
  id: string
  title: string
  detail: string | null
  dueText: string | null
  done: boolean
  position: number
  createdAt: string
}

function transformDeliverable(row: Record<string, unknown>): DeliverableRow {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    detail: (row.detail as string) ?? null,
    dueText: (row.due_text as string) ?? null,
    done: Boolean(row.done),
    position: (row.position as number) ?? 0,
    createdAt: row.created_at as string,
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

    // (position, created_at, id) — total, so the list cannot reshuffle between
    // loads. position alone leaves ties; a whole extraction inserts with the
    // same created_at often enough that id has to be the final tie-break.
    const { data, error } = await supabaseServiceRole()
      .from('canvas_deliverables')
      .select('*')
      .eq('canvas_id', (await params).id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_TOTAL_DELIVERABLES)

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error fetching deliverables:', error)
      return NextResponse.json({ error: 'Failed to fetch deliverables' }, { status: 500 })
    }

    return NextResponse.json({ deliverables: (data || []).map(transformDeliverable) })
  } catch (err) {
    console.error('Unexpected error fetching deliverables:', err)
    return NextResponse.json({ error: 'Failed to fetch deliverables' }, { status: 500 })
  }
}

// POST — add deliverables. Body: { items: [{ title, detail?, due? }] }
//
// APPENDS. Re-summarising a crit adds what it found to what is already there;
// it does not replace the list. Replacing would silently destroy the ticks and
// hand edits the user has made since, which is the one thing these rows exist
// to hold. Removing a duplicate is one click; recovering a wiped list is not.
export async function POST(
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
    const { items } = parsed.body
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 })
    }
    if (items.length > MAX_DELIVERABLES) {
      return NextResponse.json(
        { error: `At most ${MAX_DELIVERABLES} deliverables at a time` },
        { status: 400 }
      )
    }

    const db = supabaseServiceRole()

    // New rows sort after existing ones. Read the current maximum rather than
    // counting: a deleted row would make a count-based position collide with a
    // row that is still there.
    //
    // The count comes back in the same request, because the ceiling has to be
    // enforced on the WRITE. Capping only the read would let the list grow past
    // what the reader returns — rows that exist, cost storage, and are
    // invisible, with nothing anywhere saying so.
    const { data: last, error: lastError, count } = await db
      .from('canvas_deliverables')
      .select('position', { count: 'exact' })
      .eq('canvas_id', (await params).id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastError) {
      if (isMissingTable(lastError)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error reading deliverable order:', lastError)
      return NextResponse.json({ error: 'Failed to save deliverables' }, { status: 500 })
    }

    const existing = count ?? 0
    if (existing + items.length > MAX_TOTAL_DELIVERABLES) {
      return NextResponse.json(
        {
          error: `This crit already has ${existing} deliverables — the limit is ${MAX_TOTAL_DELIVERABLES}. Clear some first.`,
        },
        { status: 409 }
      )
    }

    const basePosition = ((last?.position as number) ?? 0) + 1

    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return NextResponse.json({ error: 'Each item must be an object' }, { status: 400 })
      }
      const record = item as Record<string, unknown>
      const title = typeof record.title === 'string' ? record.title.trim() : ''
      if (!title) {
        return NextResponse.json({ error: 'Each item needs a title' }, { status: 400 })
      }
      const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
      const due = typeof record.due === 'string' ? record.due.trim() : ''
      rows.push({
        canvas_id: (await params).id,
        title: title.slice(0, MAX_DELIVERABLE_TITLE),
        // Empty string becomes NULL: the column is nullable to mean "no detail",
        // and an empty string would render as a blank second line.
        detail: detail ? detail.slice(0, MAX_DELIVERABLE_DETAIL) : null,
        due_text: due ? due.slice(0, MAX_DELIVERABLE_DUE) : null,
        position: basePosition + i,
        created_by: access.authorId,
      })
    }

    const { data, error } = await db.from('canvas_deliverables').insert(rows).select('*')

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error saving deliverables:', error)
      return NextResponse.json({ error: 'Failed to save deliverables' }, { status: 500 })
    }

    return NextResponse.json({ deliverables: (data || []).map(transformDeliverable) })
  } catch (err) {
    console.error('Unexpected error saving deliverables:', err)
    return NextResponse.json({ error: 'Failed to save deliverables' }, { status: 500 })
  }
}
