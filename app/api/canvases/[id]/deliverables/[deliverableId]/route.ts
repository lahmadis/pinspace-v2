import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess, readCappedJson } from '@/lib/canvas/access'
import {
  MAX_DELIVERABLE_DETAIL,
  MAX_DELIVERABLE_DUE,
  MAX_DELIVERABLE_TITLE,
} from '@/lib/summary/types'

export const dynamic = 'force-dynamic'

// One deliverable: tick it, edit it, remove it.

// Same not-migrated handling as the sibling routes. Without it, ticking a box
// before migration 040 is applied returns a bare 500 while the list route next
// to it explains itself.
const MISSING_TABLE_CODES = ['42P01', 'PGRST205']
const NOT_MIGRATED = 'Deliverables need migration 040 applied to the database first.'

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && MISSING_TABLE_CODES.includes(code)
}

function transformDeliverable(row: Record<string, unknown>) {
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; deliverableId: string } }
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
    const body = parsed.body
    const patch: Record<string, unknown> = {}

    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') {
        return NextResponse.json({ error: 'done must be true or false' }, { status: 400 })
      }
      patch.done = body.done
    }
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return NextResponse.json({ error: 'title must not be empty' }, { status: 400 })
      }
      patch.title = body.title.trim().slice(0, MAX_DELIVERABLE_TITLE)
    }
    // detail and due accept an empty string, which clears them. That is the
    // only way to remove a wrong due date the extraction invented, so it is a
    // deliberate case rather than a validation gap.
    if (body.detail !== undefined) {
      if (typeof body.detail !== 'string') {
        return NextResponse.json({ error: 'detail must be text' }, { status: 400 })
      }
      const detail = body.detail.trim()
      patch.detail = detail ? detail.slice(0, MAX_DELIVERABLE_DETAIL) : null
    }
    if (body.due !== undefined) {
      if (typeof body.due !== 'string') {
        return NextResponse.json({ error: 'due must be text' }, { status: 400 })
      }
      const due = body.due.trim()
      patch.due_text = due ? due.slice(0, MAX_DELIVERABLE_DUE) : null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    }

    // Scoped by canvas_id as well as id, so a deliverable belonging to another
    // canvas cannot be edited through one the caller happens to own.
    const { data, error } = await supabaseServiceRole()
      .from('canvas_deliverables')
      .update(patch)
      .eq('id', params.deliverableId)
      .eq('canvas_id', params.id)
      .select('*')
      .maybeSingle()

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error updating deliverable:', error)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })

    return NextResponse.json({ deliverable: transformDeliverable(data) })
  } catch (err) {
    console.error('Unexpected error updating deliverable:', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; deliverableId: string } }
) {
  try {
    const result = await resolveCanvasAccess(request, params.id)
    if (!result.ok) {
      // Idempotent on a canvas that is already gone.
      if (result.status === 404) return NextResponse.json({ ok: true })
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    if (!access.canWrite || !access.authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabaseServiceRole()
      .from('canvas_deliverables')
      .delete()
      .eq('id', params.deliverableId)
      .eq('canvas_id', params.id)

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 })
      }
      console.error('Error deleting deliverable:', error)
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }

    // Idempotent: deleting an already-deleted row is a success, so a retry
    // after a dropped response doesn't surface an error.
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Unexpected error deleting deliverable:', err)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
