/**
 * In-memory cache for studio view data (boards + wall config).
 * Used to show the studio view immediately when opened from the bubble network
 * after prefetch on hover, and to avoid blocking the UI on first load when cache exists.
 */

import type { Board } from '@/types'

export interface CachedWallConfig {
  walls: { height: number; width: number }[]
  layoutType: string
  tables?: unknown[]
}

export interface CachedStudioData {
  boards: Board[]
  wallConfig: CachedWallConfig | null
  fetchedAt: number
}

const CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes
const cache = new Map<string, CachedStudioData>()

function cacheKey(studioId: string, isDemo: boolean): string {
  return `${studioId}:${isDemo ? 'demo' : 'live'}`
}

export function getCachedStudioData(
  studioId: string,
  isDemo: boolean
): CachedStudioData | null {
  const key = cacheKey(studioId, isDemo)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry
}

export function setCachedStudioData(
  studioId: string,
  isDemo: boolean,
  data: { boards: Board[]; wallConfig: CachedWallConfig | null }
): void {
  const key = cacheKey(studioId, isDemo)
  cache.set(key, {
    boards: data.boards,
    wallConfig: data.wallConfig,
    fetchedAt: Date.now(),
  })
}

/**
 * Prefetch boards and wall config for a studio view. Call on bubble hover
 * so that when the user clicks, the view can open with cached data immediately.
 */
export async function prefetchStudioView(
  studioId: string,
  isDemo: boolean
): Promise<void> {
  const key = cacheKey(studioId, isDemo)
  if (cache.has(key)) return // already prefetched

  try {
    const [boardsRes, configRes] = await Promise.all([
      fetch(
        isDemo
          ? `/api/boards?workspaceId=${studioId}&demo=true`
          : `/api/boards?workspaceId=${studioId}`
      ),
      fetch(
        isDemo
          ? `/api/studios/${studioId}/wall-config?demo=true`
          : `/api/studios/${studioId}/wall-config`
      ),
    ])

    const boards = boardsRes.ok ? (await boardsRes.json()).boards || [] : []
    let wallConfig: CachedWallConfig | null = null
    if (configRes.ok) {
      const data = await configRes.json()
      if (data?.config) wallConfig = data.config
    }
    if (!wallConfig) {
      wallConfig = {
        walls: [
          { height: 10, width: 8 },
          { height: 10, width: 8 },
          { height: 10, width: 8 },
          { height: 10, width: 8 },
        ],
        layoutType: 'zigzag',
      }
    }
    setCachedStudioData(studioId, isDemo, { boards, wallConfig })
  } catch {
    // ignore prefetch errors
  }
}
