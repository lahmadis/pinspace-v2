import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import JSZip from 'jszip'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIZE_CAP_BYTES = 200 * 1024 * 1024

function sanitize(s: string | null | undefined): string {
  const base = (s ?? '').toString().trim() || 'untitled'
  return base
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'untitled'
}

function extFromContent(url: string, contentType: string | null): string {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('jpeg')) return 'jpg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('pdf')) return 'pdf'
  if (ct.includes('svg')) return 'svg'
  try {
    const pathname = new URL(url).pathname
    const m = pathname.match(/\.([a-z0-9]{2,5})(?:$|\?)/i)
    if (m) return m[1].toLowerCase()
  } catch {
    // ignore — fall through to default
  }
  return 'bin'
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const workspaceId = (await params).id
    const adminDb = supabaseServiceRole()

    const { data: workspace, error: wsError } = await adminDb
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('id', workspaceId)
      .single()

    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (workspace.owner_id !== userId) {
      return NextResponse.json({ error: 'Only workspace owners can export' }, { status: 403 })
    }

    const { data: boards, error: boardsError } = await adminDb
      .from('boards')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('upload_status', 'pending')
      .order('uploaded_at', { ascending: false })

    if (boardsError) {
      console.error('export: boards fetch error:', boardsError)
      return NextResponse.json({ error: 'Failed to load boards' }, { status: 500 })
    }

    const zip = new JSZip()
    let totalBytes = 0

    type BoardRow = {
      id: string
      title: string | null
      description: string | null
      student_name: string | null
      student_email: string | null
      tags: string[] | null
      uploaded_at: string | null
      full_image_url: string | null
      position_wall_index: number | null
      position_x: number | string | null
      position_y: number | string | null
      position_width: number | string | null
      position_height: number | string | null
      position_rotation: number | string | null
    }

    const rows = (boards ?? []) as BoardRow[]

    for (const board of rows) {
      const imgUrl = board.full_image_url
      if (!imgUrl) continue
      try {
        const res = await fetch(imgUrl)
        if (!res.ok) {
          console.warn(`export: ${imgUrl} returned ${res.status}`)
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        totalBytes += buf.byteLength
        if (totalBytes > SIZE_CAP_BYTES) {
          return NextResponse.json(
            { error: 'Export exceeds the 200 MB limit. Please contact support.' },
            { status: 413 }
          )
        }
        const ext = extFromContent(imgUrl, res.headers.get('content-type'))
        const wallPart =
          board.position_wall_index != null ? String(board.position_wall_index) : 'unassigned'
        const filename = `${wallPart}_${sanitize(board.title)}_${board.id}.${ext}`
        zip.file(filename, buf)
      } catch (err) {
        console.error(`export: failed to fetch board ${board.id}:`, err)
      }
    }

    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const safeName = sanitize(workspace.name)
    // Copy into a fresh ArrayBuffer so the body type satisfies BodyInit
    // without dragging in SharedArrayBuffer from Buffer's lib types.
    const ab = new ArrayBuffer(archive.byteLength)
    new Uint8Array(ab).set(archive)
    return new NextResponse(ab, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}_export.zip"`,
        'Content-Length': String(archive.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('export: unexpected error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
