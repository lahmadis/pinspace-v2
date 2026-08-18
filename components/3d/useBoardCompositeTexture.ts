'use client'

import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { loadTexture, useBoardTexture } from './useBoardTexture'

interface TraceStroke {
  color: string
  width: number
  points: [number, number][]
}

interface TraceRow {
  id: string
  authorName: string
  authorColor: string | null
  strokes: TraceStroke[]
}

// Module cache for composite textures: boardId:refreshNonce -> THREE.Texture
const compositeTextureCache = new Map<string, THREE.Texture>()

async function createCompositeCanvasTexture(
  imageUrl: string,
  traces: TraceRow[]
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const width = img.naturalWidth || 1024
        const height = img.naturalHeight || 1024
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          // Fallback to loading standard Three.js texture
          loadTexture(imageUrl).then(resolve).catch(reject)
          return
        }

        // 1. Draw base board image
        ctx.drawImage(img, 0, 0, width, height)

        // 2. Draw trace strokes overlay
        const allStrokes: TraceStroke[] = []
        for (const traceRow of traces) {
          if (Array.isArray(traceRow.strokes)) {
            allStrokes.push(...traceRow.strokes)
          }
        }

        if (allStrokes.length > 0) {
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          for (const stroke of allStrokes) {
            if (!stroke.points || stroke.points.length < 2) continue
            ctx.beginPath()
            ctx.strokeStyle = stroke.color || '#EF4444'
            // Scale stroke width relative to image dimension (stroke.width is stored in px for ~1000px scale)
            const scaledWidth = Math.max(2, (stroke.width || 4) * (width / 1000))
            ctx.lineWidth = scaledWidth

            const [firstX, firstY] = stroke.points[0]
            ctx.moveTo(firstX * width, firstY * height)

            for (let i = 1; i < stroke.points.length; i++) {
              const [px, py] = stroke.points[i]
              ctx.lineTo(px * width, py * height)
            }
            ctx.stroke()
          }
        }

        // 3. Generate Three.js CanvasTexture
        const canvasTex = new THREE.CanvasTexture(canvas)
        canvasTex.colorSpace = THREE.SRGBColorSpace
        canvasTex.generateMipmaps = true
        canvasTex.minFilter = THREE.LinearMipmapLinearFilter
        canvasTex.magFilter = THREE.LinearFilter
        canvasTex.anisotropy = 8
        canvasTex.needsUpdate = true
        resolve(canvasTex)
      } catch (err) {
        console.warn('Failed to build composite trace canvas texture:', err)
        loadTexture(imageUrl).then(resolve).catch(reject)
      }
    }

    img.onerror = (err) => {
      console.warn('Failed to load image for trace composition:', imageUrl, err)
      loadTexture(imageUrl).then(resolve).catch(reject)
    }

    img.src = imageUrl
  })
}

export function useBoardCompositeTexture(
  boardId: string | undefined,
  imageUrl: string | null | undefined,
  refreshNonce: number = 0
): {
  texture: THREE.Texture | null
  isInitialLoad: boolean
} {
  const { texture: baseTexture, isInitialLoad: isBaseInitialLoad } = useBoardTexture(imageUrl)
  const [compositeTexture, setCompositeTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    if (!boardId || !imageUrl) {
      setCompositeTexture(null)
      return
    }

    let cancelled = false
    const cacheKey = `${boardId}:${refreshNonce}`

    if (compositeTextureCache.has(cacheKey)) {
      setCompositeTexture(compositeTextureCache.get(cacheKey)!)
      return
    }

    const fetchTracesAndComposite = async () => {
      try {
        const res = await fetch(`/api/boards/${boardId}/traces`)
        let traces: TraceRow[] = []
        if (res.ok) {
          const data = await res.json()
          traces = Array.isArray(data.traces) ? data.traces : []
        }

        if (cancelled) return

        if (traces.length === 0) {
          // No traces on board — fallback to clean base texture
          setCompositeTexture(null)
          return
        }

        const compTex = await createCompositeCanvasTexture(imageUrl, traces)
        if (cancelled) return

        compositeTextureCache.set(cacheKey, compTex)
        setCompositeTexture(compTex)
      } catch (err) {
        if (!cancelled) {
          console.warn('Error compositing board traces:', err)
          setCompositeTexture(null)
        }
      }
    }

    fetchTracesAndComposite()

    return () => {
      cancelled = true
    }
  }, [boardId, imageUrl, refreshNonce])

  const activeTexture = compositeTexture || baseTexture

  return {
    texture: activeTexture,
    isInitialLoad: activeTexture === null && isBaseInitialLoad,
  }
}
