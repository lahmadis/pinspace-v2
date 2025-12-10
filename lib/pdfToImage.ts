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
 * Convert ALL pages of a PDF file to PNG images
 * Returns an array of image files with dimensions
 */
export async function convertPDFToImages(pdfFile: File): Promise<Array<{
  imageFile: File
  width: number
  height: number
  aspectRatio: number
  pageNumber: number
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
      
      // Render at high quality
      const viewport = page.getViewport({ scale: 2.5 })
      
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
      
      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error('Failed to create blob'))
        }, 'image/png', 0.95)
      })
      
      // Create image file with page number
      const baseName = pdfFile.name.replace('.pdf', '')
      const imageFileName = numPages > 1 
        ? `${baseName}_page${pageNum}.png`
        : `${baseName}.png`
      const imageFile = new File([blob], imageFileName, { type: 'image/png' })
      
      const width = canvas.width
      const height = canvas.height
      const aspectRatio = width / height
      
      console.log(`✅ Converted page ${pageNum} to PNG:`, imageFileName)
      console.log(`   Dimensions: ${width} x ${height} | Aspect ratio: ${aspectRatio.toFixed(3)}`)
      
      results.push({
        imageFile,
        width,
        height,
        aspectRatio,
        pageNumber: pageNum
      })
    }
    
    console.log(`✅ Converted all ${numPages} page(s) from PDF`)
    return results
  } catch (error) {
    console.error('Failed to convert PDF:', error)
    throw error
  }
}

