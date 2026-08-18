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
  metadata?: Record<string, unknown>
}

async function listAllObjects(prefix = ''): Promise<string[]> {
  // Storage `list` is shallow per-prefix; recurse into folders.
  const out: string[] = []
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (error) {
    console.error(`Failed to list "${prefix}":`, error)
    return out
  }
  for (const obj of (data || []) as StorageObject[]) {
    const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name
    // A folder has no metadata + no id; recurse.
    if (!obj.id && !obj.metadata) {
      const nested = await listAllObjects(fullPath)
      out.push(...nested)
    } else {
      out.push(fullPath)
    }
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
  const { data: entries, error: listErr } = await supabase
    .storage
    .from(BUCKET)
    .list('wall-configs', { limit: 1000 })

  if (listErr) {
    console.warn('Failed to list wall-configs/ — skipping model-ref scan:', listErr)
    return referenced
  }

  let scanned = 0
  for (const entry of (entries || []) as StorageObject[]) {
    // Skip nested folders (shouldn't exist) and non-JSON files.
    if (!entry.name || !entry.name.endsWith('.json')) continue
    const filePath = `wall-configs/${entry.name}`
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(filePath)
    if (dlErr || !blob) {
      console.warn(`  Skipped ${filePath}: ${dlErr?.message || 'no data'}`)
      continue
    }
    let text: string
    try {
      text = await blob.text()
    } catch (e) {
      console.warn(`  Skipped ${filePath}: failed to read text`, e)
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      console.warn(`  Skipped ${filePath}: invalid JSON`, e)
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

  console.log('Loading model references from wall-config files...')
  const modelRefs = await loadWallConfigModelRefs()
  for (const p of modelRefs) referenced.add(p)
  console.log(`Combined referenced path(s): ${referenced.size}.`)

  // Skip wall-configs/* — those are stored in this bucket too and should not be touched.
  const orphans = allPaths.filter((p) => !p.startsWith('wall-configs/') && !referenced.has(p))
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
