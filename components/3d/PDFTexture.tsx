'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfJsWindow = Window & { pdfjsLib?: any }

// Load PDF.js from CDN — singleton promise so the script is only injected once
const loadPdfJs = (() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let promise: Promise<any> | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (): Promise<any> => {
    if ((window as PdfJsWindow).pdfjsLib) {
      return (window as PdfJsWindow).pdfjsLib
    }

    if (promise) {
      return promise
    }

    promise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
      script.async = true

      script.onload = () => {
        const pdfjsLib = (window as PdfJsWindow).pdfjsLib
        if (pdfjsLib) {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
          resolve(pdfjsLib)
        } else {
          reject(new Error('PDF.js failed to load'))
        }
      }

      script.onerror = () => {
        promise = null
        reject(new Error('Failed to load PDF.js'))
      }

      document.head.appendChild(script)
    })

    return promise
  }
})()

interface PDFTextureMaterialProps {
  pdfUrl: string
  hovered?: boolean
}

export function PDFTextureMaterial({ pdfUrl, hovered = false }: PDFTextureMaterialProps) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Keep a ref to the live texture so cleanup can always dispose the latest one,
  // even if the component re-renders for reasons other than pdfUrl changing.
  const textureRef = useRef<THREE.Texture | null>(null)

  useEffect(() => {
    let cancelled = false

    async function renderPDF() {
      try {
        setLoading(true)
        setError(false)

        const pdfjsLib = await loadPdfJs()
        if (cancelled) return

        const loadingTask = pdfjsLib.getDocument(pdfUrl)
        const pdf = await loadingTask.promise
        if (cancelled) return

        const page = await pdf.getPage(1)
        if (cancelled) return

        // Reduced scale from 3x to 2x for better performance on Vercel
        const viewport = page.getViewport({ scale: 2 })

        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) {
          throw new Error('Canvas context not available')
        }

        canvas.width = viewport.width
        canvas.height = viewport.height

        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        await page.render({ canvasContext: context, viewport }).promise

        if (cancelled) return

        const dataUrl = canvas.toDataURL('image/png')

        const loader = new THREE.TextureLoader()
        const tex = await new Promise<THREE.Texture>((resolve, reject) => {
          loader.load(
            dataUrl,
            (loadedTexture) => {
              loadedTexture.colorSpace = THREE.SRGBColorSpace
              loadedTexture.needsUpdate = true
              resolve(loadedTexture)
            },
            undefined,
            (err) => reject(err)
          )
        })

        if (cancelled) {
          tex.dispose()
          return
        }

        // Dispose previous texture before storing the new one
        textureRef.current?.dispose()
        textureRef.current = tex
        setTexture(tex)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.error('[PDFTexture] Error rendering PDF:', err)
          setError(true)
          setLoading(false)
        }
      }
    }

    renderPDF()

    return () => {
      cancelled = true
      // Dispose whatever texture is currently live (ref is always up-to-date)
      textureRef.current?.dispose()
      textureRef.current = null
      setTexture(null)
    }
  }, [pdfUrl])

  if (loading) {
    return (
      <meshStandardMaterial
        color="#E4EBFC"
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.0}
        emissive="#3B6EF6"
        emissiveIntensity={0.2}
      />
    )
  }

  if (error || !texture) {
    return (
      <meshStandardMaterial
        color="#fee2e2"
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.0}
      />
    )
  }

  return (
    <meshStandardMaterial
      map={texture}
      side={THREE.DoubleSide}
      roughness={0.7}
      metalness={0.0}
      emissive={hovered ? "#3B6EF6" : "#000000"}
      emissiveIntensity={hovered ? 0.1 : 0}
    />
  )
}
