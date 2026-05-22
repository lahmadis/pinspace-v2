import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

const CONFIG_BUCKET = 'board-images'
const CONFIG_PREFIX = 'wall-configs'

async function readConfigFromStorage(id: string): Promise<unknown> {
  try {
    const db = supabaseServiceRole()
    const filePath = `${CONFIG_PREFIX}/${id}.json`
    const { data, error } = await db.storage.from(CONFIG_BUCKET).download(filePath)
    if (error || !data) return null
    const raw = await data.text()
    if (!raw) return null
    return JSON.parse(raw)
  } catch (err) {
    console.warn('Storage wall-config read skipped:', err)
    return null
  }
}

async function writeConfigToStorage(id: string, config: unknown): Promise<void> {
  const db = supabaseServiceRole()
  const filePath = `${CONFIG_PREFIX}/${id}.json`
  const payload = Buffer.from(JSON.stringify(config), 'utf-8')
  const { error } = await db.storage.from(CONFIG_BUCKET).upload(filePath, payload, {
    upsert: true,
    contentType: 'application/json',
  })
  if (error) throw error
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params

  // Sample studios get a static default zigzag config.
  if (id.startsWith('sample-studio-')) {
    const defaultConfig = {
      layoutType: 'zigzag',
      walls: [
        { height: 10, width: 20 },
        { height: 10, width: 15 },
        { height: 10, width: 20 },
        { height: 10, width: 15 },
        { height: 10, width: 20 },
      ]
    }
    return NextResponse.json({ exists: true, config: defaultConfig }, { status: 200 })
  }

  const storageConfig = await readConfigFromStorage(id)
  if (storageConfig) {
    return NextResponse.json({ exists: true, config: storageConfig }, { status: 200 })
  }
  return NextResponse.json({ exists: false, config: null }, { status: 200 })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params

  const { data: { session } } = await supabaseServer().auth.getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  const admin = supabaseServiceRole()
  const { data: ws } = await admin.from('workspaces').select('owner_id').eq('id', id).maybeSingle()
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ws.owner_id !== userId) {
    const { data: m } = await admin.from('workspace_members').select('user_id')
      .eq('workspace_id', id).eq('user_id', userId).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
  }

  try {
    const body = await request.json()
    await writeConfigToStorage(id, body)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to save wall config:', err)
    return NextResponse.json({ success: false, error: 'Failed to save wall config' }, { status: 500 })
  }
}
