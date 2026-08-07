// Convert PDF to image on client-side during upload.
//
// Also handles Adobe Illustrator .ai files: saved with "Create PDF Compatible
// File" (Illustrator's default) they carry a full PDF stream, so PDF.js opens
// them like any other PDF and each artboard arrives as a page. Nothing in this
// file needs to know the difference — the caller decides what's PDF-like (see
// isPdfLike in lib/pdfUtils.ts).

import { stripRasterSourceExtension } from '@/lib/pdfUtils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfJsWindow = Window & { pdfjsLib?: any }

// Load PDF.js from CDN
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
      // Use jsDelivr CDN instead - less likely to be blocked
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

/**
 * Convert ALL pages of a PDF file to JPEG images.
 * Returns an array of image files with dimensions.
 *
 * Rasterization policy (kept in step with the main image pass in
 * lib/useDirectUpload.ts — the two ceilings must match, see MAX_DIMENSION below):
 * - JPEG, not PNG: vector art flattened to a photo-like raster compresses far
 *   better as JPEG, and the canvas is opaque so there is no alpha to preserve.
 * - Longest side capped at 4000px. Pages under the cap render 1:1 with their
 *   own point size (72 points = 1 inch), so scale is never > 1 — upsampling a
 *   vector source here would only inflate bytes, not add detail.
 * - JPEG quality 0.92, matching the main image pass. Line work and type on a
 *   CAD/Illustrator sheet sit right where JPEG ringing is most visible, so this
 *   is the floor for a legible sheet rather than a tunable.
 */
export async function convertPDFToImages(pdfFile: File): Promise<Array<{
  imageFile: File
  width: number
  height: number
  aspectRatio: number
  pageNumber: number
  physicalWidth?: number  // in inches
  physicalHeight?: number // in inches
}>> {
  try {
    console.log('🔄 Converting multi-page PDF to images...')
    
    const pdfjsLib = await loadPdfJs()
    
    // Read PDF file
    const arrayBuffer = await pdfFile.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Load the PDF
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array })
    const pdf = await loadingTask.promise
    
    const numPages = pdf.numPages
    console.log(`📄 PDF has ${numPages} page(s)`)
    
    const results = []
    
    // Convert each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      console.log(`🔄 Converting page ${pageNum}/${numPages}...`)
      
      const page = await pdf.getPage(pageNum)
      
      // Get physical dimensions from PDF page
      // getViewport with scale 1.0 gives us dimensions in points (1 point = 1/72 inch)
      const pageViewport = page.getViewport({ scale: 1.0 })
      const widthInPoints = pageViewport.width
      const heightInPoints = pageViewport.height
      
      // Convert points to inches (1 point = 1/72 inch)
      const physicalWidth = widthInPoints / 72
      const physicalHeight = heightInPoints / 72
      
      console.log(`📐 [PDF] Page ${pageNum} dimensions: ${widthInPoints.toFixed(2)}pt x ${heightInPoints.toFixed(2)}pt = ${physicalWidth.toFixed(2)}" x ${physicalHeight.toFixed(2)}"`)
      
      // Cap rasterization at 4000px on the longest dimension — the same
      // ceiling browser-image-compression uses for the main upload, so
      // rendering bigger is throwaway work. Small PDFs render at 1:1 (no
      // upsampling); large architecture sheets get scaled down once here
      // instead of being downsampled again downstream. See section 22 of
      // docs/storage-audit-P1.md.
      //
      // Raised from 2400: at that ceiling a 24x36" sheet rasterized to roughly
      // 66 DPI, which is what made Illustrator exports read as pixelated. This
      // MUST stay equal to maxWidthOrHeight in lib/useDirectUpload.ts, or the
      // main compression pass silently downsamples the page a second time.
      const MAX_DIMENSION = 4000
      const viewport1x = page.getViewport({ scale: 1 })
      const naturalMax = Math.max(viewport1x.width, viewport1x.height)
      const scale = naturalMax > MAX_DIMENSION ? MAX_DIMENSION / naturalMax : 1
      const viewport = page.getViewport({ scale })
      
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { alpha: false })
      
      if (!context) {
        throw new Error('Canvas context not available')
      }
      
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      
      // White background
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      
      // Render the page
      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise
      
      // Convert canvas to JPEG blob (much smaller than PNG).
      // 0.92, raised from 0.85: this raster is line work and type, where JPEG
      // ringing shows up first. Matches the main pass in lib/useDirectUpload.ts.
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error('Failed to create blob'))
        }, 'image/jpeg', 0.92)
      })
      
      // Create image file with page number (JPEG extension)
      const baseName = stripRasterSourceExtension(pdfFile.name)
      const imageFileName = numPages > 1 
        ? `${baseName}_page${pageNum}.jpg`
        : `${baseName}.jpg`
      const imageFile = new File([blob], imageFileName, { type: 'image/jpeg' })
      
      const width = canvas.width
      const height = canvas.height
      const aspectRatio = width / height
      
      const fileSizeMB = (imageFile.size / (1024 * 1024)).toFixed(2)
      console.log(`✅ Converted page ${pageNum} to JPEG:`, imageFileName)
      console.log(`   Pixel dimensions: ${width} x ${height} | Aspect ratio: ${aspectRatio.toFixed(3)}`)
      console.log(`   Physical dimensions: ${physicalWidth.toFixed(2)}" x ${physicalHeight.toFixed(2)}"`)
      console.log(`   File size: ${fileSizeMB} MB | Scale: ${scale.toFixed(2)}x`)
      
      results.push({
        imageFile,
        width,
        height,
        aspectRatio,
        pageNumber: pageNum,
        physicalWidth,
        physicalHeight
      })
    }
    
    console.log(`✅ Converted all ${numPages} page(s) from PDF`)
    return results
  } catch (error) {
    console.error('Failed to convert PDF:', error)
    throw error
  }
}

