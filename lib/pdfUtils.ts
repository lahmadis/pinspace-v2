// Simple PDF utilities - no external dependencies
// PDFs will be displayed using browser's native embed/iframe

export interface PDFInfo {
  url: string
  isPDF: boolean
}

/**
 * Check if a URL points to a PDF file
 */
export function isPDFUrl(url: string | undefined | null): boolean {
  if (!url) return false
  return url.toLowerCase().endsWith('.pdf')
}

/**
 * Get a thumbnail URL for a PDF (placeholder for now)
 * In the future, this could call a server-side PDF rendering endpoint
 */
export function getPDFThumbnailUrl(pdfUrl: string): string {
  // Return the PDF URL itself - browser will handle display
  return pdfUrl
}
