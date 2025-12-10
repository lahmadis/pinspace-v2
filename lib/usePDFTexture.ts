'use client'

import { useState, useEffect } from 'react'

// Simple hook that just returns info about the PDF
// Actual rendering will be done via embed/iframe in components

export function usePDFImage(pdfUrl: string | null, _scale: number = 2) {
  const [loading] = useState(false)
  const [error] = useState<Error | null>(null)

  // For now, just return the URL - PDFs will be displayed via embed
  const result = pdfUrl ? {
    dataUrl: pdfUrl, // Use the original URL
    width: 612, // Standard letter width in points
    height: 792, // Standard letter height in points
    aspectRatio: 612 / 792,
  } : null

  return { result, loading, error }
}

// Placeholder for 3D texture - PDFs will show as styled placeholders in 3D
export function usePDFTexture(pdfUrl: string | null, _scale: number = 2) {
  return {
    texture: null,
    loading: false,
    error: null,
    dimensions: pdfUrl ? { width: 612, height: 792, aspectRatio: 612 / 792 } : null,
  }
}
