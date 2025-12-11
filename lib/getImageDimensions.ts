/**
 * Get dimensions of an image file
 */
export async function getImageDimensions(file: File): Promise<{
  width: number
  height: number
  aspectRatio: number
}> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    
    img.onload = () => {
      const width = img.naturalWidth
      const height = img.naturalHeight
      const aspectRatio = width / height
      
      URL.revokeObjectURL(url)
      
      console.log('📐 Image dimensions:', width, 'x', height, '| Aspect ratio:', aspectRatio.toFixed(3))
      
      resolve({ width, height, aspectRatio })
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    
    img.src = url
  })
}







