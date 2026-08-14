/**
 * One-time cleanup of orphaned objects in the `board-images` storage bucket.
 *
 * Lists every file in the bucket, checks whether anything references it
 * (boards.thumbnail_url, boards.full_image_url, or any tables[].modelUrl in the
 * wall-config JSONs under wall-configs/), and deletes objects with no matching
 * reference. Paths under wall-configs/ are themselves never treated as orphans.
 *
 * Recommended invocation (works on Node 20.6+, which supports `--env-file` natively):
 *   npx tsx --env-file=.env.local scripts/cleanup-orphan-storage.ts          # dry-run (default)
 *   npx tsx --env-file=.env.local scripts/cleanup-orphan-storage.ts --apply  # actually delete
 *   npx tsx --env-file=.env.local scripts/cleanup-orphan-storage.ts --apply --min-age-hours=48
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
const DEFAULT_MIN_AGE_HOURS = 24
const minAgeArg = process.argv.find((arg) => arg.startsWith('--min-age-hours='))
const MIN_AGE_HOURS = minAgeArg
  ? Number(minAgeArg.slice('--min-age-hours='.length))
  : DEFAULT_MIN_AGE_HOURS

if (!Number.isFinite(MIN_AGE_HOURS) || MIN_AGE_HOURS < 1) {
  console.error('--min-age-hours must be a number greater than or equal to 1.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

interface StorageObject {
  name: string
  id?: string
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

interface ListedStorageObject {
  path: string
  createdAt: string | null
}

async function listAllObjects(prefix = ''): Promise<ListedStorageObject[]> {
  // Storage `list` is shallow per-prefix; recurse into folders.
  const out: ListedStorageObject[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      throw new Error(`Failed to list "${prefix}": ${error.message}`)
    }
    const page = (data || []) as StorageObject[]
    for (const obj of page) {
      const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name
      // A folder has no metadata + no id; recurse.
      if (!obj.id && !obj.metadata) {
        const nested = await listAllObjects(fullPath)
        out.push(...nested)
      } else {
        out.push({ path: fullPath, createdAt: obj.created_at ?? obj.updated_at ?? null })
      }
    }
    if (page.length < pageSize) break
  }
  return out
}

function extractStoragePath(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const raw = url.slice(idx + marker.length).split('?')[0]
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

async function loadReferencedPaths(): Promise<Set<string>> {
  const referenced = new Set<string>()
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await supabase
      .from('boards')
      .select('thumbnail_url, full_image_url')
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const t = extractStoragePath(row.thumbnail_url)
      const f = extractStoragePath(row.full_image_url)
      if (t) referenced.add(t)
      if (f) referenced.add(f)
    }
    if (data.length < pageSize) break
    from += pageSize
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
  const entries = await listAllObjects('wall-configs')

  let scanned = 0
  for (const entry of entries) {
    if (!entry.path.endsWith('.json')) continue
    const filePath = entry.path
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(filePath)
    if (dlErr || !blob) {
      throw new Error(`Failed to read ${filePath}: ${dlErr?.message || 'no data'}`)
    }
    let text: string
    try {
      text = await blob.text()
    } catch (e) {
      throw new Error(`Failed to read ${filePath} as text`, { cause: e })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(`Invalid JSON in ${filePath}`, { cause: e })
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
  console.log(`Minimum object age: ${MIN_AGE_HOURS} hour(s).`)

  console.log('Listing all storage objects...')
  const allObjects = await listAllObjects('')
  console.log(`Found ${allObjects.length} storage object(s).`)

  console.log('Loading referenced paths from boards table...')
  const referenced = await loadReferencedPaths()
  console.log(`Found ${referenced.size} referenced path(s) across boards.`)

  console.log('Loading model references from wall-config files...')
  const modelRefs = await loadWallConfigModelRefs()
  for (const p of modelRefs) referenced.add(p)
  console.log(`Combined referenced path(s): ${referenced.size}.`)

  // A direct upload exists briefly before its boards row. The age floor prevents
  // that normal gap from looking orphaned. Missing/invalid timestamps fail safe.
  const oldestAllowedTimestamp = Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000
  const orphans = allObjects
    .filter(({ path }) => !path.startsWith('wall-configs/') && !referenced.has(path))
    .filter(({ path, createdAt }) => {
      const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN
      const oldEnough = Number.isFinite(createdAtMs) && createdAtMs <= oldestAllowedTimestamp
      if (!oldEnough) console.log(`Skipping recent or timestamp-unknown object: ${path}`)
      return oldEnough
    })
    .map(({ path }) => path)
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
    console.log(`Re-checking references before deletion batch ${i}–${Math.min(i + batchSize, orphans.length)}...`)
    const latestReferenced = await loadReferencedPaths()
    const latestModelRefs = await loadWallConfigModelRefs()
    for (const path of latestModelRefs) latestReferenced.add(path)
    const batch = orphans.slice(i, i + batchSize).filter((path) => !latestReferenced.has(path))
    if (batch.length === 0) {
      console.log('Batch skipped: every candidate is now referenced.')
      continue
    }
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
