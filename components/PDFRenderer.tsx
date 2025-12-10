'use client'

import { useEffect, useRef, useState } from 'react'

interface PDFRendererProps {
  pdfUrl: string
  className?: string
  scale?: number
}

// Load PDF.js from CDN
const loadPdfJs = (() => {
  let loading = false
  let loaded = false
  
  return async (): Promise<any> => {
    if (loaded && (window as any).pdfjsLib) {
      return (window as any).pdfjsLib
    }
    
    if (loading) {
      // Wait for the script to load
      return new Promise((resolve) => {
        const checkLoaded = setInterval(() => {
          if ((window as any).pdfjsLib) {
            clearInterval(checkLoaded)
            resolve((window as any).pdfjsLib)
          }
        }, 100)
      })
    }
    
    loading = true
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
      script.async = true
      
      script.onload = () => {
        const pdfjsLib = (window as any).pdfjsLib
        if (pdfjsLib) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
          loaded = true
          loading = false
          resolve(pdfjsLib)
        } else {
          reject(new Error('PDF.js failed to load'))
        }
      }
      
      script.onerror = () => {
        loading = false
        reject(new Error('Failed to load PDF.js'))
      }
      
      document.head.appendChild(script)
    })
  }
})()

export default function PDFRenderer({ pdfUrl, className, scale = 1.5 }: PDFRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function renderPDF() {
      if (!canvasRef.current) {
        console.log('📄 [PDFRenderer] Canvas ref not ready yet')
        return
      }

      try {
        console.log('📄 [PDFRenderer] Starting to render PDF:', pdfUrl)
        setLoading(true)
        setError(null)

        // Load PDF.js from CDN
        const pdfjsLib = await loadPdfJs()
        console.log('📄 [PDFRenderer] PDF.js loaded')

        if (cancelled) return

        // Load the PDF
        const loadingTask = pdfjsLib.getDocument(pdfUrl)
        const pdf = await loadingTask.promise
        console.log('📄 [PDFRenderer] PDF document loaded')

        if (cancelled) return

        // Get first page
        const page = await pdf.getPage(1)
        console.log('📄 [PDFRenderer] Got page 1')

        if (cancelled) return

        const viewport = page.getViewport({ scale })
        console.log('📄 [PDFRenderer] Viewport:', viewport.width, 'x', viewport.height)
        
        const canvas = canvasRef.current
        
        if (!canvas) return

        const context = canvas.getContext('2d', { alpha: false })
        if (!context) {
          setError('Canvas context not available')
          return
        }

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        
        // White background
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        console.log('📄 [PDFRenderer] Rendering page to canvas...')
        // Render the page
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        }

        await page.render(renderContext).promise
        console.log('✅ [PDFRenderer] PDF rendered to canvas successfully!')

        if (!cancelled) {
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('❌ [PDFRenderer] Error:', err)
          setError('Failed to load PDF')
          setLoading(false)
        }
      }
    }

    renderPDF()

    return () => {
      cancelled = true
    }
  }, [pdfUrl, scale])

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-red-50 ${className}`}>
        <div className="text-center p-4">
          <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-indigo-600 rounded-full mx-auto mb-2" />
            <span className="text-xs text-gray-500">Loading PDF...</span>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  )
}

