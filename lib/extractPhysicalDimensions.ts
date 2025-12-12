/**
 * Extract physical dimensions from files (like InDesign does)
 * For PDFs: Uses page dimensions in points (1 point = 1/72 inch)
 * For images: Uses pixel dimensions and DPI to calculate physical size
 */

// Load PDF.js from CDN (same as pdfToImage.ts)
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

/**
 * Extract physical dimensions from a PDF file
 * Returns dimensions in inches
 */
export async function extractPDFPhysicalDimensions(pdfFile: File): Promise<{
  physicalWidth: number  // in inches
  physicalHeight: number // in inches
}> {
  try {
    // Must run on client-side
    if (typeof window === 'undefined') {
      throw new Error('PDF extraction must run on client-side')
    }

    const pdfjsLib = await loadPdfJs()
    
    // Read PDF file
    const arrayBuffer = await pdfFile.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Load the PDF
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array })
    const pdf = await loadingTask.promise
    
    // Get first page dimensions (assuming all pages are same size)
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.0 })
    
    // PDF dimensions are in points (1 point = 1/72 inch)
    const widthInPoints = viewport.width
    const heightInPoints = viewport.height
    
    // Convert points to inches
    const widthInches = widthInPoints / 72
    const heightInches = heightInPoints / 72
    
    console.log(`📐 PDF physical dimensions: ${widthInPoints.toFixed(2)}pt x ${heightInPoints.toFixed(2)}pt = ${widthInches.toFixed(2)}" x ${heightInches.toFixed(2)}"`)
    
    return {
      physicalWidth: widthInches,
      physicalHeight: heightInches
    }
  } catch (error) {
    console.error('Failed to extract PDF physical dimensions:', error)
    throw error
  }
}

/**
 * Extract physical dimensions from an image file
 * Uses EXIF data to get DPI, or defaults to 72 DPI for web images, 300 DPI for print
 */
export async function extractImagePhysicalDimensions(imageFile: File): Promise<{
  physicalWidth: number  // in inches
  physicalHeight: number // in inches
  dpi: number           // detected or assumed DPI
}> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(imageFile)
    
    img.onload = async () => {
      try {
        const pixelWidth = img.naturalWidth
        const pixelHeight = img.naturalHeight
        
        // Try to extract DPI from EXIF data
        let dpi = 72 // Default DPI for web images
        
        // Check if we can get EXIF data
        // Note: Browser EXIF extraction requires a library like exif-js
        // For now, we'll use intelligent defaults:
        // - 72 DPI for smaller images (likely web/screen captures)
        // - 300 DPI for larger images (likely print/scan)
        
        if (pixelWidth > 2000 || pixelHeight > 2000) {
          // Large images are likely high-resolution scans or print files
          dpi = 300
        } else {
          // Smaller images are likely screenshots or web images
          dpi = 72
        }
        
        // Calculate physical dimensions: pixels / DPI = inches
        const physicalWidth = pixelWidth / dpi
        const physicalHeight = pixelHeight / dpi
        
        console.log(`📐 Image physical dimensions: ${pixelWidth}px x ${pixelHeight}px @ ${dpi} DPI = ${physicalWidth.toFixed(2)}" x ${physicalHeight.toFixed(2)}"`)
        
        URL.revokeObjectURL(url)
        
        resolve({
          physicalWidth,
          physicalHeight,
          dpi
        })
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    
    img.src = url
  })
}

/**
 * Extract physical dimensions from any file (PDF or image)
 */
export async function extractPhysicalDimensions(file: File): Promise<{
  physicalWidth: number  // in inches
  physicalHeight: number // in inches
  dpi?: number          // DPI (only for images)
}> {
  if (file.type === 'application/pdf') {
    const dims = await extractPDFPhysicalDimensions(file)
    return dims
  } else {
    const dims = await extractImagePhysicalDimensions(file)
    return {
      physicalWidth: dims.physicalWidth,
      physicalHeight: dims.physicalHeight,
      dpi: dims.dpi
    }
  }
}

