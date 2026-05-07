'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

/**
 * Imperative texture loader that holds the previous texture on screen until the
 * new one resolves. This avoids the double Suspense gray-flash that happens
 * when a board's URL swaps from optimistic blob → thumbnail → full image.
 *
 * Returns:
 *   texture        — currently displayable texture (may belong to the old URL while a new one loads)
 *   isInitialLoad  — true only when there has never been a texture yet (use this to render a skeleton)
 */
export function useBoardTexture(url: string | null | undefined): {
  texture: THREE.Texture | null
  isInitialLoad: boolean
} {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const settledUrlRef = useRef<string | null>(null)
  const inFlightUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!url) {
      // No URL at all — clear everything.
      settledUrlRef.current = null
      inFlightUrlRef.current = null
      setTexture((prev) => {
        if (prev) prev.dispose()
        return null
      })
      return
    }

    // Already showing this URL — nothing to do.
    if (settledUrlRef.current === url) return
    // Already loading this URL — let the previous load finish.
    if (inFlightUrlRef.current === url) return

    inFlightUrlRef.current = url
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (newTex) => {
        if (cancelled) {
          newTex.dispose()
          return
        }
        newTex.colorSpace = THREE.SRGBColorSpace
        newTex.generateMipmaps = true
        newTex.minFilter = THREE.LinearMipmapLinearFilter
        newTex.magFilter = THREE.LinearFilter
        newTex.anisotropy = 2
        newTex.needsUpdate = true
        settledUrlRef.current = url
        inFlightUrlRef.current = null
        // Swap atomically; dispose the old texture only after the new one has been committed.
        setTexture((prev) => {
          if (prev && prev !== newTex) prev.dispose()
          return newTex
        })
      },
      undefined,
      (err) => {
        if (cancelled) return
        console.warn('Board texture load failed:', url, err)
        inFlightUrlRef.current = null
      }
    )

    return () => {
      cancelled = true
      // Don't clear inFlightUrlRef here — a re-render with the same url should
      // not retrigger the load.
    }
  }, [url])

  // Dispose on unmount.
  useEffect(() => {
    return () => {
      setTexture((prev) => {
        if (prev) prev.dispose()
        return null
      })
    }
  }, [])

  return {
    texture,
    isInitialLoad: texture === null,
  }
}
