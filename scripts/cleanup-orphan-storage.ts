/**
 * One-time cleanup of orphaned objects in the `board-images` storage bucket.
 *
 * Lists every file in the bucket, checks whether any row in `boards` references it
 * (via thumbnail_url or full_image_url), and deletes objects with no matching row.
 *
 * Run (Node 20.6+, which supports `--env-file` natively):
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-orphan-storage.ts          # dry-run (default)
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-orphan-storage.ts --apply  # actually delete
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

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will delete)' : 'DRY-RUN (will not delete)'}`)

  console.log('Listing all storage objects...')
  const allPaths = await listAllObjects('')
  console.log(`Found ${allPaths.length} storage object(s).`)

  console.log('Loading referenced paths from boards table...')
  const referenced = await loadReferencedPaths()
  console.log(`Found ${referenced.size} referenced path(s) across boards.`)

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
