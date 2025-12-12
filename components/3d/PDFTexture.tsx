'use client'

import { useEffect, useState } from 'react'
import * as THREE from 'three'

// Load PDF.js from CDN
const loadPdfJs = (() => {
  let promise: Promise<any> | null = null
  
  return async (): Promise<any> => {
    if ((window as any).pdfjsLib) {
      return (window as any).pdfjsLib
    }
    
    if (promise) {
      return promise
    }
    
    promise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
      script.async = true
      
      script.onload = () => {
        const pdfjsLib = (window as any).pdfjsLib
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

  useEffect(() => {
    let cancelled = false
    let currentTexture: THREE.Texture | null = null

    async function renderPDF() {
      try {
        console.log('📄 [PDFTexture] Loading PDF:', pdfUrl)
        setLoading(true)
        setError(false)

        const pdfjsLib = await loadPdfJs()
        if (cancelled) return

        console.log('📄 [PDFTexture] PDF.js loaded, getting document...')
        const loadingTask = pdfjsLib.getDocument(pdfUrl)
        const pdf = await loadingTask.promise
        if (cancelled) return

        console.log('📄 [PDFTexture] PDF loaded, getting page 1...')
        const page = await pdf.getPage(1)
        if (cancelled) return

        // Reduced scale from 3x to 2x for better performance on Vercel
        const viewport = page.getViewport({ scale: 2 })
        console.log('📄 [PDFTexture] Viewport size:', viewport.width, 'x', viewport.height)
        
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) {
          throw new Error('Canvas context not available')
        }

        canvas.width = viewport.width
        canvas.height = viewport.height

        // White background
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        console.log('📄 [PDFTexture] Rendering PDF to canvas...')
        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise
        
        if (cancelled) return

        console.log('📄 [PDFTexture] Converting canvas to data URL...')
        const dataUrl = canvas.toDataURL('image/png')
        
        console.log('📄 [PDFTexture] Loading texture from data URL...')
        // Use TextureLoader for better compatibility
        const loader = new THREE.TextureLoader()
        const tex = await new Promise<THREE.Texture>((resolve, reject) => {
          loader.load(
            dataUrl,
            (loadedTexture) => {
              console.log('✅ [PDFTexture] Texture loaded from data URL!')
              loadedTexture.colorSpace = THREE.SRGBColorSpace
              loadedTexture.needsUpdate = true
              resolve(loadedTexture)
            },
            undefined,
            (err) => {
              console.error('❌ [PDFTexture] Failed to load texture:', err)
              reject(err)
            }
          )
        })

        if (cancelled) {
          tex.dispose()
          return
        }

        currentTexture = tex
        setTexture(tex)
        setLoading(false)
        
        console.log('✅ [PDFTexture] PDF texture ready!')
      } catch (err) {
        if (!cancelled) {
          console.error('❌ [PDFTexture] Error:', err)
          setError(true)
          setLoading(false)
        }
      }
    }

    renderPDF()

    return () => {
      cancelled = true
      if (currentTexture) {
        currentTexture.dispose()
      }
    }
  }, [pdfUrl])

  if (loading) {
    console.log('⏳ [PDFTexture] Showing loading state for:', pdfUrl)
    return (
      <meshStandardMaterial 
        color="#e0e7ff"
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.0}
        emissive="#6366f1"
        emissiveIntensity={0.2}
      />
    )
  }

  if (error || !texture) {
    console.log('❌ [PDFTexture] Showing error state for:', pdfUrl)
    return (
      <meshStandardMaterial 
        color="#fee2e2"
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.0}
      />
    )
  }

  console.log('✅ [PDFTexture] Rendering with texture for:', pdfUrl)
  return (
    <meshStandardMaterial 
      map={texture} 
      side={THREE.DoubleSide}
      roughness={0.7}
      metalness={0.0}
      emissive={hovered ? "#6366f1" : "#000000"}
      emissiveIntensity={hovered ? 0.1 : 0}
    />
  )
}
