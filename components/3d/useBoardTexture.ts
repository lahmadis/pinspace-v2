'use client'

import { useEffect, useState } from 'react'
import * as THREE from 'three'

/**
 * Imperative texture loader that holds the previous texture on screen until the
 * new one resolves. This avoids the double Suspense gray-flash that happens
 * when a board's URL swaps from optimistic blob → thumbnail → full image.
 *
 * **Module-level cache:** resolved textures and in-flight loads are keyed by URL
 * so unmount/remount of a board (e.g. switching between BoardThumbnail in 3D and
 * DraggableBoard in 2D edit mode) reuses the same texture instantly — no skeleton
 * flash for content that was already loaded.
 *
 * Returns:
 *   texture        — currently displayable texture (may belong to the old URL while a new one loads)
 *   isInitialLoad  — true only when there has never been a texture yet (use this to render a skeleton)
 */

// Module-level caches shared across every hook instance in the app.
//
// Entries are reference counted. A texture is disposed ONLY when its refCount
// is 0: disposing one that is still on screen renders that board black, which
// is a worse failure than holding the memory. Bare `loadTexture` calls (the
// upload pre-warm in hooks/useBoardUpload.ts and the wall-hover pre-warm in
// StudioRoom) deliberately leave entries at refCount 0 — nothing is displaying
// them yet, so they are exactly what eviction should reclaim first.
interface CacheEntry {
  texture: THREE.Texture
  /** Mounted consumers currently displaying this texture. Never evict when > 0. */
  refCount: number
  /** Monotonic tick used for least-recently-used ordering. */
  lastUsed: number
}

const resolvedCache = new Map<string, CacheEntry>()
const inFlightCache = new Map<string, Promise<THREE.Texture>>()

/**
 * How many refCount-0 entries survive before the oldest are disposed. Entries
 * with refCount > 0 are neither counted nor evicted, so this bounds the IDLE
 * retained set rather than the total. A room's on-screen boards therefore never
 * compete with this budget.
 */
const MAX_IDLE_ENTRIES = 30

let lruTick = 0

/**
 * Dispose least-recently-used idle entries until at most MAX_IDLE_ENTRIES
 * remain. Matches the disposal style already used in PDFTexture and
 * TableWithModel: call `.dispose()` on the THREE object, then drop the handle.
 */
function evictIdleEntries(): void {
  const idle: Array<[string, CacheEntry]> = []
  for (const pair of resolvedCache) {
    if (pair[1].refCount <= 0) idle.push(pair)
  }
  if (idle.length <= MAX_IDLE_ENTRIES) return

  idle.sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [url, entry] of idle.slice(0, idle.length - MAX_IDLE_ENTRIES)) {
    // Re-assert the invariant at the point of disposal rather than trusting the
    // scan above. This is the single place a board texture is ever freed.
    if (entry.refCount > 0) continue
    entry.texture.dispose()
    resolvedCache.delete(url)
  }
}

/**
 * Drop one consumer's claim. At zero the entry becomes evictable, so this is
 * the other place eviction can be triggered.
 */
function releaseTexture(url: string): void {
  const entry = resolvedCache.get(url)
  if (!entry) return
  entry.refCount = Math.max(0, entry.refCount - 1)
  entry.lastUsed = ++lruTick
  if (entry.refCount === 0) evictIdleEntries()
}

/** Used when the GPU's real limit can't be read (SSR, no WebGL, no extension). */
const ANISOTROPY_FALLBACK = 2
/**
 * Ceiling on what we'll actually ask for. Hardware commonly reports 16, and
 * past that the sampling cost keeps rising while the visible gain on a
 * wall-mounted board does not.
 */
const ANISOTROPY_CAP = 16

let maxAnisotropyCache: number | null = null

/**
 * The GPU's max anisotropic filtering, clamped to ANISOTROPY_CAP.
 *
 * Boards hang flat on walls the camera almost always views at an angle, which
 * is precisely the case trilinear mipmapping blurs — so the previous hard-coded
 * 2 was throwing away most of the sharpness the hardware can give for free.
 *
 * Resolved once, lazily, from a throwaway WebGL context rather than a renderer:
 * configureTexture runs inside a module-level cache reached from non-component
 * callers (the upload pre-warm in hooks/useBoardUpload.ts, the wall-hover
 * pre-warm in StudioRoom), none of which hold a renderer reference. This is the
 * same query THREE.WebGLCapabilities.getMaxAnisotropy() performs internally, so
 * the number matches what the real renderer would report.
 *
 * Note three returns 0 — not 1 — when the extension is absent, hence the
 * `> 0` guard before trusting the value.
 */
function resolveMaxAnisotropy(): number {
  if (maxAnisotropyCache !== null) return maxAnisotropyCache
  // SSR / prerender: no document. Return the fallback WITHOUT caching, so the
  // first real call in the browser still resolves the true value.
  if (typeof document === 'undefined') return ANISOTROPY_FALLBACK

  let resolved = ANISOTROPY_FALLBACK
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null
    if (gl) {
      const ext =
        gl.getExtension('EXT_texture_filter_anisotropic') ??
        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ??
        gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
      if (ext) {
        const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
        if (Number.isFinite(max) && max > 0) {
          resolved = Math.min(ANISOTROPY_CAP, Math.floor(max))
        }
      }
      // Hand the context back immediately — browsers cap concurrent WebGL
      // contexts, and this one exists only to read a constant.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    // Blocked/unavailable WebGL — keep the fallback.
    resolved = ANISOTROPY_FALLBACK
  }

  maxAnisotropyCache = resolved
  return resolved
}

function configureTexture(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = resolveMaxAnisotropy()
  tex.needsUpdate = true
  return tex
}

/**
 * Pre-warm the module-level texture cache for a URL. Call this as soon as a URL is known
 * (e.g. when an upload starts and a blob URL is created, or when the upload returns the
 * real thumbnail URL) so by the time a component renders that URL its texture is already
 * resolved — no skeleton flash, no swap delay.
 */
export function loadTexture(url: string): Promise<THREE.Texture> {
  // Already resolved — return synchronously via Promise.resolve. Touch the LRU
  // so a hit moves the entry away from the eviction end of the queue.
  const cached = resolvedCache.get(url)
  if (cached) {
    cached.lastUsed = ++lruTick
    return Promise.resolve(cached.texture)
  }
  // Already loading — share the same promise so we don't double-fetch.
  const inFlight = inFlightCache.get(url)
  if (inFlight) return inFlight

  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        configureTexture(tex)
        // refCount 0: a bare loadTexture is a pre-warm with no mounted owner.
        // useBoardTexture takes its reference immediately after this resolves,
        // which is what lifts the entry out of eviction range. The entry is
        // inserted with the newest lastUsed, so the evict pass below can never
        // choose it — it is by construction the most-recently-used idle entry.
        resolvedCache.set(url, { texture: tex, refCount: 0, lastUsed: ++lruTick })
        inFlightCache.delete(url)
        evictIdleEntries()
        resolve(tex)
      },
      undefined,
      (err) => {
        inFlightCache.delete(url)
        reject(err)
      }
    )
  })
  inFlightCache.set(url, promise)
  return promise
}

export function useBoardTexture(url: string | null | undefined): {
  texture: THREE.Texture | null
  isInitialLoad: boolean
} {
  // Synchronously seed from the resolved cache so a remount returns the texture on the first render —
  // no skeleton flash when the user toggles between 3D and 2D edit views for an already-loaded board.
  // This is a READ ONLY. The reference is taken in the effect below so that every
  // increment has exactly one matching decrement in that effect's own cleanup;
  // taking it here would leak a count on every re-render.
  const initialCached = url ? resolvedCache.get(url)?.texture ?? null : null
  const [texture, setTexture] = useState<THREE.Texture | null>(initialCached)

  useEffect(() => {
    if (!url) {
      setTexture(null)
      return
    }

    let cancelled = false
    // The single url this effect has taken a reference on, captured in the
    // closure so the cleanup can never release a different key than the one it
    // acquired. StrictMode double-invokes effects as mount → cleanup → mount,
    // which runs acquire → release → acquire and nets out to exactly one
    // reference; a url change is handled the same way by the dep array.
    let acquiredUrl: string | null = null

    const adopt = (tex: THREE.Texture) => {
      const entry = resolvedCache.get(url)
      if (entry) {
        entry.refCount += 1
        entry.lastUsed = ++lruTick
      } else {
        // Defensive: only reachable if the entry vanished between resolving and
        // adopting. Eviction is synchronous and always spares the newest entry,
        // so this should not occur — but re-registering the texture we already
        // hold is strictly better than rendering a disposed (black) board.
        tex.needsUpdate = true
        resolvedCache.set(url, { texture: tex, refCount: 1, lastUsed: ++lruTick })
      }
      acquiredUrl = url
      setTexture(tex)
    }

    // Cache hit: commit immediately, no network. Catches the remount case described above.
    const cached = resolvedCache.get(url)
    if (cached) {
      adopt(cached.texture)
    } else {
      // Cache miss: load (or join the in-flight promise) but keep the previous texture
      // visible in the meantime so URL swaps don't flash.
      loadTexture(url)
        .then((tex) => {
          if (cancelled) return
          adopt(tex)
        })
        .catch((err) => {
          if (cancelled) return
          console.warn('Board texture load failed:', url, err)
        })
    }

    return () => {
      cancelled = true
      // Null whenever adopt never ran (unmounted before the load resolved), so
      // there is nothing to release and the count stays balanced.
      if (acquiredUrl) releaseTexture(acquiredUrl)
    }
  }, [url])

  return {
    texture,
    // Only show the skeleton when nothing has ever been displayed for this hook instance.
    isInitialLoad: texture === null,
  }
}
