import { supabaseServiceRole } from '@/lib/supabase/server'
import {
  collectWallConfigModelPaths,
  type BoardObjectRow,
} from '@/lib/storage/boardObjects'

type AdminClient = ReturnType<typeof supabaseServiceRole>

interface StorageObject {
  name: string
  id?: string
  metadata?: Record<string, unknown>
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: number; statusCode?: number | string; message?: string }
  return value.status === 404 || value.statusCode === 404 || value.statusCode === '404' || /not.?found/i.test(value.message ?? '')
}

export async function listStorageObjectPaths(
  admin: AdminClient,
  prefix: string
): Promise<string[]> {
  const paths: string[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage
      .from('board-images')
      .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    const page = (data ?? []) as StorageObject[]
    for (const object of page) {
      const path = prefix ? `${prefix}/${object.name}` : object.name
      if (!object.id && !object.metadata) {
        paths.push(...await listStorageObjectPaths(admin, path))
      } else {
        paths.push(path)
      }
    }
    if (page.length < pageSize) break
  }
  return paths
}

export async function loadWallConfigModelPaths(
  admin: AdminClient,
  configPaths: Iterable<string>
): Promise<Set<string>> {
  const configs: unknown[] = []
  for (const path of new Set(configPaths)) {
    if (!path.endsWith('.json')) continue
    const { data, error } = await admin.storage.from('board-images').download(path)
    if (error || !data) {
      if (error && isNotFound(error)) continue
      throw error ?? new Error(`No data returned for ${path}`)
    }
    const text = await data.text()
    configs.push(JSON.parse(text))
  }
  return collectWallConfigModelPaths(configs)
}

export async function loadBoardObjectRows(
  admin: AdminClient,
  workspaceId?: string
): Promise<BoardObjectRow[]> {
  const rows: BoardObjectRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let query = admin.from('boards').select('thumbnail_url, full_image_url')
    if (workspaceId) query = query.eq('workspace_id', workspaceId)
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as BoardObjectRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}
