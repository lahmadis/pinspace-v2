import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

const CONFIG_BUCKET = 'board-images'
const CONFIG_PREFIX = 'wall-configs'

/**
 * The stored blob is `{ version, ...config }`. `version` is an integer bumped
 * on every successful write so concurrent editors can detect a stale save
 * (optimistic concurrency). Blobs written before versioning have no `version`
 * field — we read them as version 0 and the next save bumps to 1. The version
 * lives inside the same JSON object (Tier 2 decision: embed in blob, no DB
 * table, accept the tiny read-then-write TOCTOU race for the pilot).
 */
type StoredConfig = { version: number; config: Record<string, unknown> }

/**
 * Per-room blob path. When roomId is omitted we fall back to the legacy
 * workspace-scoped path (`wall-configs/{wsId}.json`) so older clients that
 * haven't been updated yet — and existing rooms whose per-room blob hasn't
 * been seeded yet — keep functioning. New rooms get seeded at create time so
 * they don't pick up the workspace blob's edits.
 */
function configPath(wsId: string, roomId: string | null): string {
  return roomId
    ? `${CONFIG_PREFIX}/${wsId}/${roomId}.json`
    : `${CONFIG_PREFIX}/${wsId}.json`
}

async function readConfigAt(filePath: string): Promise<StoredConfig | null> {
  try {
    const db = supabaseServiceRole()
    const { data, error } = await db.storage.from(CONFIG_BUCKET).download(filePath)
    if (error || !data) return null
    const raw = await data.text()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Strip `version` back out so it never leaks into the config the client
      // renders / re-sends. Missing or non-numeric → version 0 (legacy blob).
      const { version, ...config } = parsed as Record<string, unknown>
      const v = typeof version === 'number' && Number.isFinite(version) ? version : 0
      return { version: v, config }
    }
    return { version: 0, config: {} }
  } catch (err) {
    console.warn('Storage wall-config read skipped:', err)
    return null
  }
}

async function writeConfigToStorage(filePath: string, config: unknown, version: number): Promise<void> {
  const db = supabaseServiceRole()
  // Spread config first so the authoritative `version` always wins, even if a
  // stale `version` rode in on the client's config payload.
  const blob = { ...(config as Record<string, unknown>), version }
  const payload = Buffer.from(JSON.stringify(blob), 'utf-8')
  const { error } = await db.storage.from(CONFIG_BUCKET).upload(filePath, payload, {
    upsert: true,
    contentType: 'application/json',
  })
  if (error) throw error
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const roomId = request.nextUrl.searchParams.get('roomId')

  // Sample studios get a static default zigzag config (read-only, never POSTed).
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
    return NextResponse.json({ exists: true, config: defaultConfig, version: 0 }, { status: 200 })
  }

  // Per-room read first when roomId is supplied; fall back to the legacy
  // workspace blob so existing rooms (created before this change, no per-room
  // blob yet) keep showing their current config. The first save will bump the
  // version against whatever path we end up writing to.
  if (roomId) {
    const perRoom = await readConfigAt(configPath(id, roomId))
    if (perRoom) {
      return NextResponse.json({ exists: true, config: perRoom.config, version: perRoom.version }, { status: 200 })
    }
    const legacy = await readConfigAt(configPath(id, null))
    if (legacy) {
      return NextResponse.json({ exists: true, config: legacy.config, version: legacy.version }, { status: 200 })
    }
    return NextResponse.json({ exists: false, config: null, version: 0 }, { status: 200 })
  }

  const stored = await readConfigAt(configPath(id, null))
  if (stored) {
    return NextResponse.json({ exists: true, config: stored.config, version: stored.version }, { status: 200 })
  }
  return NextResponse.json({ exists: false, config: null, version: 0 }, { status: 200 })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const roomId = request.nextUrl.searchParams.get('roomId')

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
    // Envelope is `{ baseVersion, config }`. A bare config body (no envelope)
    // is treated as baseVersion 0 for backward compatibility.
    const hasEnvelope =
      body && typeof body === 'object' && !Array.isArray(body) && 'config' in body && 'baseVersion' in body
    const incomingConfig = hasEnvelope ? body.config : body
    const baseVersion =
      hasEnvelope && typeof body.baseVersion === 'number' && Number.isFinite(body.baseVersion)
        ? body.baseVersion
        : 0

    // Writes target the per-room blob when roomId is supplied; the version
    // counter is scoped to that same blob. The legacy path is only used when
    // roomId is omitted (back-compat for older clients).
    const writePath = configPath(id, roomId)
    const current = await readConfigAt(writePath)
    const currentVersion = current?.version ?? 0

    // Stale write: the client's base is behind what's stored. Reject with 409
    // and hand back the latest (config + version) so the client can reload in a
    // single roundtrip instead of silently clobbering another user's changes.
    if (current && baseVersion !== currentVersion) {
      return NextResponse.json(
        { error: 'stale', latest: { ...current.config, version: currentVersion } },
        { status: 409 }
      )
    }

    const nextVersion = currentVersion + 1
    await writeConfigToStorage(writePath, incomingConfig, nextVersion)
    return NextResponse.json({ success: true, version: nextVersion })
  } catch (err) {
    console.error('Failed to save wall config:', err)
    return NextResponse.json({ success: false, error: 'Failed to save wall config' }, { status: 500 })
  }
}
