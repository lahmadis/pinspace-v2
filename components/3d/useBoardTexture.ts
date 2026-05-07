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

function configureTexture(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 2
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

  useEffect(() => {
    if (!url) {
      setTexture(null)
      return
    }
    // Cache hit: commit immediately, no network. Catches the remount case described above.
    const cached = resolvedCache.get(url)
    if (cached) {
      setTexture(cached)
      return
    }

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
    texture,
    // Only show the skeleton when nothing has ever been displayed for this hook instance.
    isInitialLoad: texture === null,
  }
}
