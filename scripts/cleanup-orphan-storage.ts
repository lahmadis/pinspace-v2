/**
 * One-time cleanup of orphaned objects in the `board-images` storage bucket.
 *
 * Lists every file in the bucket, checks whether anything references it, and
 * deletes objects with no matching reference. Four sources of references, and
 * missing ANY of them means deleting live files:
 *
 *   - boards.thumbnail_url / boards.full_image_url
 *   - canvas_nodes.props for image nodes (url, thumbUrl, storagePath, thumbPath)
 *   - tables[].modelUrl inside every wall-config JSON, which live NESTED at
 *     wall-configs/{workspaceId}/{roomId}.json
 *   - anything uploaded in the last hour, which may be an upload in progress
 *     whose referencing row does not exist yet
 *
 * Paths under wall-configs/ are themselves never treated as orphans.
 *
 * Every scan ABORTS on failure rather than returning what it managed to read.
 * A partial reference set is indistinguishable from "these files are garbage",
 * so a cleanup that cannot see everything must delete nothing.
 *
 * Recommended invocation (works on Node 20.6+, which supports `--env-file` natively):
 *   npx tsx --env-file=.env.local scripts/cleanup-orphan-storage.ts          # dry-run (default)
 *   npx tsx --env-file=.env.local scripts/cleanup-orphan-storage.ts --apply  # actually delete
 *
 * On Node 22+, you can also use the experimental built-in TS stripper instead of tsx:
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-orphan-storage.ts
 *
 * Or set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY manually in your shell
 * and drop the `--env-file` flag. NEVER run with --apply unless you have a recent backup.
 *
 * Note: this script is intentionally not run automatically. Invoke it manually after
 * confirming you understand which objects will be deleted (re-run without --apply first).
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const BUCKET = 'board-images'
const APPLY = process.argv.includes('--apply')

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

interface StorageObject {
  name: string
  id?: string
  created_at?: string
  metadata?: Record<string, unknown>
}

const LIST_PAGE = 1000

/**
 * Every object under a prefix, recursing into folders.
 *
 * Paged AND throwing, both deliberately. `list` returns at most `limit` entries
 * per call, so a single unpaged request silently stopped at 1000 per folder;
 * and swallowing an error returned a SHORT list. Under-listing is the safe
 * direction for deletion — you delete less — but it is the wrong direction for
 * loadWallConfigModelRefs, which lists in order to find things it must PROTECT.
 * There, a short list means deleting more. One function serves both, so it has
 * to be right for the stricter caller.
 */
/**
 * Objects younger than this are never treated as orphans.
 *
 * An upload is not atomic with the row that references it: the bytes land
 * first, the `boards` INSERT or `canvas_nodes` create follows a moment later,
 * and a canvas image drop writes TWO objects before either is referenced. A
 * scan that runs in that gap sees a real, in-progress upload as garbage and
 * deletes it out from under the person making it.
 *
 * An hour is far longer than any upload and costs nothing — an object that is
 * genuinely orphaned is still orphaned on the next run.
 */
const MIN_ORPHAN_AGE_MS = 60 * 60 * 1000

interface ListedObject {
  path: string
  /** Storage's created_at, when it reports one. */
  createdAt: number | null
}

async function listAllObjects(prefix = ''): Promise<ListedObject[]> {
  const out: ListedObject[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      throw new Error(`Failed to list "${prefix}" (aborting): ${error.message}`)
    }
    const page = (data || []) as StorageObject[]
    if (page.length === 0) break
    for (const obj of page) {
      const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name
      // A folder has no metadata + no id; recurse.
      if (!obj.id && !obj.metadata) {
        out.push(...(await listAllObjects(fullPath)))
      } else {
        const stamp = Date.parse(String(obj.created_at ?? ''))
        out.push({ path: fullPath, createdAt: Number.isNaN(stamp) ? null : stamp })
      }
    }
    if (page.length < LIST_PAGE) break
    offset += page.length
  }
  return out
}

function extractStoragePath(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length).split('?')[0])
}

/**
 * KEYSET paging, not offset paging.
 *
 * `.range()` walks by position, so a row deleted earlier in the sort during a
 * scan shifts everything left and the row at the page boundary is never
 * returned — and a board whose row we never saw has its images deleted as
 * orphans. Adding ORDER BY fixes non-determinism but not this; only paging by
 * the last id seen does, because the cursor is a value rather than a count.
 *
 * Worth the extra care in this file specifically: every row missed here is a
 * file deleted.
 */
const PAGE_SIZE = 1000

async function loadReferencedPaths(): Promise<Set<string>> {
  const referenced = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    let query = supabase
      .from('boards')
      .select('id, thumbnail_url, full_image_url')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (cursor !== null) query = query.gt('id', cursor)

    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const t = extractStoragePath(row.thumbnail_url)
      const f = extractStoragePath(row.full_image_url)
      if (t) referenced.add(t)
      if (f) referenced.add(f)
    }
    if (data.length < PAGE_SIZE) break
    cursor = data[data.length - 1].id as string
  }
  return referenced
}

/**
 * Image nodes on a canvas store their upload in THIS bucket, under the same
 * `{userId}/…` prefix a board image uses — they go through lib/useDirectUpload
 * unchanged, so nothing about the path distinguishes them.
 *
 * That makes this function load-bearing rather than a nicety. Without it every
 * desk-crit image is unreferenced as far as the boards scan is concerned, and
 * a single `--apply` run deletes the lot — silently, because the objects are
 * gone but the canvas_nodes rows survive and keep pointing at dead URLs.
 *
 * Both keys are read: `url` is the full upload and `thumbUrl` the 1200px copy
 * the canvas actually draws, and they are separate objects in the bucket.
 */
/**
 * Postgres's undefined_table. The ONLY code treated as "this table is absent".
 *
 * PostgREST's own PGRST205 is deliberately NOT here. It means "not found in the
 * schema cache", which covers a genuinely missing table AND a cache that has
 * not caught up — the exact state for a few minutes after 036/037 is applied.
 * In that window the table exists and is full of rows, and accepting the code
 * as "no canvas images" would delete every one of them. Ambiguity is not
 * acceptable when the answer decides what gets deleted, so PGRST205 aborts and
 * asks for a retry.
 */
const UNDEFINED_TABLE = '42P01'
const STALE_SCHEMA_CACHE = 'PGRST205'

async function loadCanvasNodeRefs(): Promise<Set<string>> {
  const referenced = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    // Keyset paging, for the reason given above loadReferencedPaths.
    let query = supabase
      .from('canvas_nodes')
      .select('id, props')
      .eq('type', 'image')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (cursor !== null) query = query.gt('id', cursor)

    const { data, error } = await query

    if (error) {
      if (error.code === UNDEFINED_TABLE) {
        console.warn('canvas_nodes does not exist here — no canvas images to protect.')
        return referenced
      }
      if (error.code === STALE_SCHEMA_CACHE) {
        throw new Error(
          'canvas_nodes was not found in the PostgREST schema cache. If the canvas ' +
            'migrations ARE applied this is a stale cache — wait a minute and re-run. ' +
            'Refusing to continue: treating this as "no canvas images" would delete them all.'
        )
      }
      // ANY other failure must abort the whole run, exactly as the boards scan
      // does. Returning what we managed to read would hand main() a partial
      // reference set, and every canvas image on an unread page would be
      // deleted as an orphan. A cleanup that cannot see all the references
      // must not delete anything.
      throw new Error(`Failed to read canvas_nodes (aborting): ${error.message}`)
    }

    if (!data || data.length === 0) break
    for (const row of data) {
      const props = row.props as Record<string, unknown> | null
      // URLs AND the raw bucket keys. They are 1:1 today, but storagePath is
      // the authoritative reference and the only one that would survive a
      // switch to signed URLs — reading both costs nothing and removes a way
      // for this to quietly stop protecting things later.
      for (const key of ['url', 'thumbUrl', 'storagePath', 'thumbPath']) {
        const value = props?.[key]
        if (typeof value !== 'string' || !value) continue
        const path = key.endsWith('Path') ? value : extractStoragePath(value)
        if (path) referenced.add(path)
      }
    }
    if (data.length < PAGE_SIZE) break
    cursor = data[data.length - 1].id as string
  }
  return referenced
}

/**
 * Each wall-config JSON (`wall-configs/{studioId}.json` in this bucket) may contain
 * `tables[].modelUrl` pointing at .glb 3D-model objects also stored in this bucket.
 * Pull every such URL into the referenced set so the cleanup never deletes them.
 */
async function loadWallConfigModelRefs(): Promise<Set<string>> {
  const referenced = new Set<string>()

  // RECURSIVE, via listAllObjects.
  //
  // This previously did a shallow `list('wall-configs')` and kept only entries
  // ending in `.json`. Configs are written to `wall-configs/{workspaceId}/
  // {roomId}.json` (app/api/workspaces/[id]/rooms/route.ts), so that list
  // returned workspace FOLDERS, every one of which failed the .json test — the
  // scan found nothing, every referenced .glb and .stl looked unreferenced, and
  // an --apply run deleted the lot. Only the legacy flat path was ever covered.
  const files = (await listAllObjects('wall-configs'))
    .map((o) => o.path)
    .filter((p) => p.endsWith('.json'))

  let scanned = 0
  for (const filePath of files) {
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(filePath)
    // Throw, do not skip. A config we cannot read is a config whose model
    // references we do not know — and the caller deletes anything it has not
    // seen referenced. Continuing here is how a transient network blip turns
    // into someone's 3D models being deleted.
    if (dlErr || !blob) {
      throw new Error(`Failed to read ${filePath} (aborting): ${dlErr?.message || 'no data'}`)
    }
    let text: string
    try {
      text = await blob.text()
    } catch (e) {
      throw new Error(`Failed to read ${filePath} as text (aborting): ${String(e)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      // Invalid JSON is the one case worth continuing past: the file is
      // genuinely unreadable by anything, so it references nothing that could
      // be protected, and aborting would make one corrupt config block every
      // future cleanup. Loud, because it is also a real problem.
      console.warn(`  ${filePath} is not valid JSON — it protects nothing:`, e)
      continue
    }
    scanned += 1
    const tables = (parsed as { tables?: Array<{ modelUrl?: unknown }> } | null)?.tables
    if (!Array.isArray(tables)) continue
    for (const table of tables) {
      const modelUrl = typeof table?.modelUrl === 'string' ? table.modelUrl : null
      if (!modelUrl) continue
      // Skip data: / blob: URLs — those aren't bucket objects.
      if (modelUrl.startsWith('data:') || modelUrl.startsWith('blob:')) continue
      const path = extractStoragePath(modelUrl)
      if (path) referenced.add(path)
    }
  }
  console.log(`Scanned ${scanned} wall-config file(s); found ${referenced.size} model reference(s).`)
  return referenced
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will delete)' : 'DRY-RUN (will not delete)'}`)

  console.log('Listing all storage objects...')
  const allPaths = await listAllObjects('')
  console.log(`Found ${allPaths.length} storage object(s).`)

  console.log('Loading referenced paths from boards table...')
  const referenced = await loadReferencedPaths()
  console.log(`Found ${referenced.size} referenced path(s) across boards.`)

  console.log('Loading image references from canvas nodes...')
  const canvasRefs = await loadCanvasNodeRefs()
  for (const p of canvasRefs) referenced.add(p)
  console.log(`Found ${canvasRefs.size} referenced path(s) across canvas image nodes.`)

  console.log('Loading model references from wall-config files...')
  const modelRefs = await loadWallConfigModelRefs()
  for (const p of modelRefs) referenced.add(p)
  console.log(`Combined referenced path(s): ${referenced.size}.`)

  // Skip wall-configs/* — those are stored in this bucket too and should not be touched.
  const unreferenced = allPaths.filter(
    (o) => !o.path.startsWith('wall-configs/') && !referenced.has(o.path)
  )

  // Anything too new to judge. An upload in flight has its bytes in the bucket
  // before the row that references it exists — see MIN_ORPHAN_AGE_MS.
  const cutoff = Date.now() - MIN_ORPHAN_AGE_MS
  const tooNew = unreferenced.filter((o) => o.createdAt !== null && o.createdAt > cutoff)
  const orphans = unreferenced
    .filter((o) => o.createdAt === null || o.createdAt <= cutoff)
    .map((o) => o.path)

  if (tooNew.length > 0) {
    console.log(
      `Skipping ${tooNew.length} unreferenced object(s) newer than ${MIN_ORPHAN_AGE_MS / 60000} minutes ` +
        '(possible uploads in progress).'
    )
  }
  console.log(`Identified ${orphans.length} orphaned object(s).`)
  for (const p of orphans) console.log(`  ${p}`)

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to delete.')
    return
  }
  if (orphans.length === 0) {
    console.log('Nothing to delete.')
    return
  }

  // Storage `remove` accepts up to ~1000 paths per call.
  const batchSize = 500
  for (let i = 0; i < orphans.length; i += batchSize) {
    const batch = orphans.slice(i, i + batchSize)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) {
      console.error(`Batch ${i}–${i + batch.length} failed:`, error)
    } else {
      console.log(`Deleted ${batch.length} (batch ${i}–${i + batch.length}).`)
    }
  }
  console.log('Cleanup finished.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
