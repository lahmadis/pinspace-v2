import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

// Wall-config is read live by guests/returning viewers; never cache it (mirror
// the boards routes' force-dynamic + no-store). A stale default layout drops
// boards that sit on non-default wall indices.
export const dynamic = 'force-dynamic'

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

/**
 * A read either found the blob, proved it absent, or failed to find out.
 *
 * The third case used to be indistinguishable from the second: both returned
 * null, and the GET reported `{exists:false, version:0}` for each. A client that
 * hit a transient storage error therefore believed the room had NO layout at
 * version 0, seeded defaults over a room that already had a real layout, and
 * bumped the version — 409ing the actual editor. Telling them apart is what lets
 * the client fall back to its rebase-before-write guard instead of writing blind.
 */
type ConfigRead =
  | { status: 'found'; stored: StoredConfig }
  | { status: 'absent' }
  | { status: 'error' }

/**
 * Supabase Storage reports a missing object as an error, so "not found" has to be
 * picked out of the error rather than inferred from its presence. Anything we
 * can't positively identify as a 404 is treated as a real failure — guessing
 * "absent" is the bug this exists to prevent.
 */
function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  if (e.status === 404 || e.statusCode === 404 || e.statusCode === '404') return true
  return typeof e.message === 'string' && /not.?found/i.test(e.message)
}

async function readConfigAt(filePath: string): Promise<ConfigRead> {
  try {
    const db = supabaseServiceRole()
    const { data, error } = await db.storage.from(CONFIG_BUCKET).download(filePath)
    if (error || !data) {
      if (error && !isNotFound(error)) {
        console.warn('Storage wall-config read failed:', filePath, error)
        return { status: 'error' }
      }
      return { status: 'absent' }
    }
    const raw = await data.text()
    // Present but empty: nothing to parse, and nothing worth protecting.
    if (!raw) return { status: 'absent' }
    // Present but unparseable is NOT absent. The blob exists and holds something
    // we don't understand; reporting it absent would invite a client to seed
    // defaults straight over it.
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.warn('Storage wall-config blob is not valid JSON:', filePath, err)
      return { status: 'error' }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Strip `version` back out so it never leaks into the config the client
      // renders / re-sends. Missing or non-numeric → version 0 (legacy blob).
      const { version, ...config } = parsed as Record<string, unknown>
      const v = typeof version === 'number' && Number.isFinite(version) ? version : 0
      return { status: 'found', stored: { version: v, config } }
    }
    return { status: 'found', stored: { version: 0, config: {} } }
  } catch (err) {
    console.warn('Storage wall-config read failed:', filePath, err)
    return { status: 'error' }
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

  // Every GET response carries Cache-Control: no-store so a browser/CDN never
  // serves a stale wall layout (matches /api/crit/[token]/boards).
  const jsonNoStore = (body: unknown, init?: { status?: number }) => {
    const res = NextResponse.json(body, init)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

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
    return jsonNoStore({ exists: true, config: defaultConfig, version: 0 }, { status: 200 })
  }

  // Per-room read first when roomId is supplied; fall back to the legacy
  // workspace blob so existing rooms (created before this change, no per-room
  // blob yet) keep showing their current config. The first save will bump the
  // version against whatever path we end up writing to.
  // `readError` responses deliberately carry NO `version`. Clients gate on
  // `typeof version === 'number'`, and 0 satisfies that — which is exactly how a
  // failed read used to masquerade as a known version 0 and license a blind
  // seed-write. Omitting it makes the client's existing "version unknown" path
  // (rebase against the server before writing) engage on its own.
  const readErrorBody = { exists: false, config: null, readError: true }

  if (roomId) {
    const perRoom = await readConfigAt(configPath(id, roomId))
    if (perRoom.status === 'found') {
      return jsonNoStore(
        { exists: true, config: perRoom.stored.config, version: perRoom.stored.version },
        { status: 200 }
      )
    }
    // Do NOT fall back to the legacy blob when the per-room read FAILED: absent
    // is what licenses the fallback, and we don't know that this is absent.
    if (perRoom.status === 'error') return jsonNoStore(readErrorBody, { status: 200 })

    const legacy = await readConfigAt(configPath(id, null))
    if (legacy.status === 'found') {
      return jsonNoStore(
        { exists: true, config: legacy.stored.config, version: legacy.stored.version },
        { status: 200 }
      )
    }
    if (legacy.status === 'error') return jsonNoStore(readErrorBody, { status: 200 })
    return jsonNoStore({ exists: false, config: null, version: 0 }, { status: 200 })
  }

  const stored = await readConfigAt(configPath(id, null))
  if (stored.status === 'found') {
    return jsonNoStore(
      { exists: true, config: stored.stored.config, version: stored.stored.version },
      { status: 200 }
    )
  }
  if (stored.status === 'error') return jsonNoStore(readErrorBody, { status: 200 })
  return jsonNoStore({ exists: false, config: null, version: 0 }, { status: 200 })
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
    // Behaviour-preserving mapping onto readConfigAt's discriminated result: a
    // failed read collapses to null exactly as it did before, so the conflict
    // rule below is untouched. (A read error here still lets a baseVersion-0
    // write land on a blob that may exist — but the client no longer SENDS that
    // write, since a readError GET now leaves its version unknown and routes it
    // through the rebase guard. Hardening the POST itself is a server-side
    // change and is deliberately out of scope for this pass.)
    const read = await readConfigAt(writePath)
    const current = read.status === 'found' ? read.stored : null
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
