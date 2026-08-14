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
const pendingPrefetches = new Map<string, Promise<void>>()
let cacheGeneration = 0

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

export function clearStudioViewCache(): void {
  cacheGeneration += 1
  cache.clear()
  pendingPrefetches.clear()
}

/**
 * Prefetch boards and wall config for a studio view. Call on bubble hover
 * so that when the user clicks, the view can open with cached data immediately.
 */
export async function prefetchStudioView(
  roomId: string,
  isDemo: boolean,
  workspaceId: string
): Promise<void> {
  const key = cacheKey(roomId, isDemo)
  if (cache.has(key)) return // already prefetched
  const pending = pendingPrefetches.get(key)
  if (pending) return pending
  const generation = cacheGeneration

  const prefetch = (async () => {
    const [boardsRes, configRes] = await Promise.all([
      fetch(
        isDemo
          ? `/api/boards?roomId=${roomId}&demo=true`
          : `/api/boards?roomId=${roomId}`
      ),
      fetch(
        isDemo
          ? `/api/studios/${workspaceId}/wall-config?demo=true`
          : `/api/studios/${workspaceId}/wall-config`
      ),
    ])

    // A failed boards request must not be cached as an empty room. The view page
    // can then perform its normal load instead of accepting a poisoned cache.
    if (!boardsRes.ok) return

    const boards = (await boardsRes.json()).boards || []
    let wallConfig: CachedWallConfig | null = null
    if (configRes.ok) {
      const data = await configRes.json()
      if (data?.config) wallConfig = data.config
    }
    if (generation === cacheGeneration) {
      setCachedStudioData(roomId, isDemo, { boards, wallConfig })
    }
  })()

  pendingPrefetches.set(key, prefetch)
  try {
    await prefetch
  } catch {
    // Prefetch is an optimization; the destination page owns user-facing errors.
  } finally {
    if (pendingPrefetches.get(key) === prefetch) pendingPrefetches.delete(key)
  }
}
