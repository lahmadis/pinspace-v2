/**
 * Image nodes on a canvas: sizing, and reading a file's real dimensions.
 *
 * Imports nothing, like the other canvas type modules, so the browser can use
 * it without pulling server code in.
 */

/** Props an image node carries. `type` is already in migration 036's CHECK. */
export interface ImageNodeProps {
  /** Full-size upload. Kept for a future lightbox; not what the canvas renders. */
  url: string
  /**
   * The ~1200px thumbnail, and what the canvas actually draws.
   *
   * A crit board can hold a dozen references, and rendering each at the 4000px
   * main size means tens of megabytes of decoded bitmap for pictures that
   * occupy a few hundred screen pixels. The full URL stays in props so nothing
   * is lost by this choice.
   */
  thumbUrl: string
  /** Bucket paths, so a delete could reclaim the objects. See the note below. */
  storagePath: string
  thumbPath?: string
  /** Original filename, for alt text. */
  name?: string
}

/**
 * Longest side of a freshly placed image, in canvas units.
 *
 * Chosen against STICKY_SIZE (180): a reference image wants to be clearly
 * bigger than a note without swamping the board. Aspect ratio is always
 * preserved, so this bounds whichever side is longer.
 */
export const IMAGE_PLACE_MAX = 480

/**
 * Fallback when a file's dimensions cannot be read. Deliberately square.
 *
 * Note this is not only the placeholder size — it becomes the node's committed
 * width and height, so an image that could not be measured stays square until
 * someone resizes it. Better than refusing the upload over a failed decode,
 * but it is a real, visible consequence rather than a cosmetic one.
 */
export const IMAGE_FALLBACK_SIZE = 320

/** How long to wait for a decoder before giving up and using the fallback. */
const MEASURE_TIMEOUT_MS = 5000

/**
 * Fit natural pixel dimensions into the placement box, preserving aspect.
 *
 * Scales DOWN only. A 60x40 icon dropped on the canvas should stay small
 * rather than being blown up to 480 wide and turning into mush.
 */
export function fitPlacedSize(
  naturalWidth: number,
  naturalHeight: number
): { w: number; h: number } {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { w: IMAGE_FALLBACK_SIZE, h: IMAGE_FALLBACK_SIZE }
  }
  const scale = Math.min(1, IMAGE_PLACE_MAX / Math.max(naturalWidth, naturalHeight))
  return {
    w: Math.round(naturalWidth * scale),
    h: Math.round(naturalHeight * scale),
  }
}

/**
 * Read a file's pixel dimensions before it is uploaded.
 *
 * Before, not after, so the placeholder that appears at the drop point is
 * already the right shape — an image that lands and then jumps to a different
 * aspect ratio reads as a bug.
 *
 * createImageBitmap first: it decodes off the main thread, so a 12-megapixel
 * phone photo does not freeze the canvas mid-drag. The Image fallback covers
 * browsers and formats it refuses, and both are wrapped so a failure yields
 * null and a square placeholder rather than an exception on a drop.
 */
export async function readImageSize(
  file: File
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Raced against the deadline. This is the branch every modern browser
      // takes and it fully decodes the image, so a pathological file stalls
      // here — and because the caller measures all dropped files together, one
      // stalled decode holds up every placeholder. Losing the race yields null
      // and falls through to the fallback rather than hanging the drop.
      const bitmap = await Promise.race([
        createImageBitmap(file),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS)),
      ])
      if (bitmap) {
        const size = { width: bitmap.width, height: bitmap.height }
        // Explicitly released: a decoded bitmap holds its full uncompressed
        // buffer, and dropping several large photos at once without this keeps
        // every one of them alive until the collector happens to run.
        bitmap.close?.()
        return size
      }
    } catch {
      // Fall through — some browsers refuse HEIC and a few exotic PNGs here.
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    let settled = false

    const finish = (size: { width: number; height: number } | null) => {
      // Latched: the timeout and a late onload can both fire, and revoking the
      // object URL twice or resolving twice would be a silent mess.
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(size)
    }

    // A decoder that fires NEITHER onload nor onerror leaves this promise
    // pending forever, and the drop that awaits it never produces a
    // placeholder or an error — the file simply vanishes. Rare, but the
    // failure mode is invisible, so it gets a deadline. A square placeholder
    // is a much better outcome than nothing happening.
    const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS)

    img.onload = () => finish({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => finish(null)
    img.src = url
  })
}

/** Types the canvas accepts on a drop. */
export const CANVAS_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const

export function isCanvasImage(file: File): boolean {
  return (CANVAS_IMAGE_TYPES as readonly string[]).includes(file.type)
}

/**
 * Why a dropped file was refused, in words worth showing.
 *
 * PDFs are named specifically. They are the obvious thing to drag onto a crit
 * board, the app already rasterises them elsewhere (lib/pdfToImage.ts), and a
 * silent no-op would read as the drop target being broken rather than as a
 * format not being wired up yet.
 */
export function rejectionReason(file: File): string {
  if (file.type === 'application/pdf') {
    return `PDFs can't go on a canvas yet — export ${file.name} as an image first.`
  }
  // Named specifically because it is what an iPhone hands you. The board
  // uploader converts HEIC to JPEG before storage (hooks/useBoardUpload.ts);
  // the canvas does not run that step yet, so the honest answer is how to work
  // around it rather than a generic "unsupported".
  if (file.type === 'image/heic' || file.type === 'image/heif') {
    return `iPhone HEIC photos aren't supported on a canvas yet — save ${file.name} as JPEG first.`
  }
  return `${file.name} isn't an image the canvas can take (JPEG, PNG or WebP).`
}
