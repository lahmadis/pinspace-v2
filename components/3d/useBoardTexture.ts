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
const resolvedCache = new Map<string, THREE.Texture>()
const inFlightCache = new Map<string, Promise<THREE.Texture>>()

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
  // Already resolved — return synchronously via Promise.resolve.
  const cached = resolvedCache.get(url)
  if (cached) return Promise.resolve(cached)
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
        resolvedCache.set(url, tex)
        inFlightCache.delete(url)
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
  const initialCached = url ? resolvedCache.get(url) ?? null : null
  const [texture, setTexture] = useState<THREE.Texture | null>(initialCached)
  const cachedTexture = url ? resolvedCache.get(url) ?? null : null
  const displayTexture = url ? cachedTexture ?? texture : null

  useEffect(() => {
    if (!url || resolvedCache.has(url)) return

    // Cache miss: load (or join the in-flight promise) but keep the previous texture
    // visible in the meantime so URL swaps don't flash.
    let cancelled = false
    loadTexture(url)
      .then((tex) => {
        if (cancelled) return
        setTexture(tex)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('Board texture load failed:', url, err)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return {
    texture: displayTexture,
    // Only show the skeleton when nothing has ever been displayed for this hook instance.
    isInitialLoad: displayTexture === null,
  }
}
