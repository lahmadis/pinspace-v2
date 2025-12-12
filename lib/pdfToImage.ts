// Convert PDF to image on client-side during upload

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
      // Use jsDelivr CDN instead - less likely to be blocked
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

/**
 * Convert ALL pages of a PDF file to JPEG images (optimized for performance)
 * Returns an array of image files with dimensions
 * 
 * Optimizations:
 * - Uses JPEG instead of PNG (much smaller file sizes)
 * - Limits max dimension to 2000px to prevent huge images
 * - Uses 1.5x scale by default (reduced from 2.5x)
 * - 85% JPEG quality for good balance
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
      
      // Render at optimized quality (reduced from 2.5x to 1.5x for better performance)
      // Calculate optimal scale: target max 2000px on longest side for reasonable file sizes
      const baseScale = 1.5
      const maxDimension = 2000
      const baseWidth = widthInPoints * baseScale
      const baseHeight = heightInPoints * baseScale
      const longestSide = Math.max(baseWidth, baseHeight)
      
      // If image would be too large, reduce scale
      const scale = longestSide > maxDimension 
        ? (maxDimension / Math.max(widthInPoints, heightInPoints))
        : baseScale
      
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
      
      // Convert canvas to JPEG blob (much smaller than PNG)
      // Use 0.85 quality for good balance between quality and file size
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error('Failed to create blob'))
        }, 'image/jpeg', 0.85)
      })
      
      // Create image file with page number (JPEG extension)
      const baseName = pdfFile.name.replace('.pdf', '')
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

