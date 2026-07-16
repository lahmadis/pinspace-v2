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

/**
 * Is this an Adobe Illustrator file?
 *
 * Detected by EXTENSION, deliberately never by MIME. A .ai file's reported type
 * comes from the OS type registry, not its contents, so it varies by machine:
 * application/postscript, application/pdf, or empty string are all plausible.
 * Empty is the dangerous one — the upload gates keep '' in their allowed MIME
 * lists for Android HEIC, so a MIME-based check would let an empty-MIME .ai pass
 * as an image and fail deep inside useDirectUpload instead of reaching the
 * rasterizer. The filename is the only signal that means the same thing on every
 * machine.
 */
export function isAiFile(file: File): boolean {
  return /\.ai$/i.test(file.name)
}

/**
 * Can the PDF rasterizer read this file? True for real PDFs, and for .ai files:
 * Illustrator's "Create PDF Compatible File" (on by default) embeds a full PDF
 * stream in the .ai, which PDF.js reads as an ordinary multi-page PDF — one page
 * per artboard.
 *
 * A .ai saved WITHOUT that option has no PDF stream and will throw in PDF.js.
 * That's unknowable from the filename, so it's handled where it surfaces: see
 * the rasterization catch in hooks/useBoardUpload.ts.
 */
export function isPdfLike(file: File): boolean {
  return file.type === 'application/pdf' || isAiFile(file)
}

/**
 * Strip the source extension when deriving a board title from a filename.
 *
 * Replaces a literal `.replace('.pdf', '')`, which was wrong in two ways once
 * .ai joined this path: it left .ai names untouched ("drawing.ai" → boards
 * titled "drawing.ai", rasterized files "drawing.ai.jpg"), and being unanchored
 * it would maul a name that merely CONTAINED the substring ("my.pdf.notes.pdf").
 * Anchored to the end and case-insensitive, so "PLAN.PDF" and "logo.AI" both
 * come out clean.
 */
export function stripRasterSourceExtension(name: string): string {
  return name.replace(/\.(pdf|ai)$/i, '')
}
