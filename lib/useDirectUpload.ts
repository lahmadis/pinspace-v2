'use client'

import { useState, useCallback } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase } from '@/lib/supabase/client'
import { MAX_IMAGE_SIZE_BYTES, maxModelBytesForName, SUPPORTED_MODEL_EXTENSIONS } from '@/lib/uploadLimits'

// HEIC/HEIF are accepted here because the upload pipeline converts them to
// JPEG (via heic2any in hooks/useBoardUpload.ts) BEFORE calling this hook.
// Listing the original MIME types defends against any path that hands an
// unconverted HEIC straight through — better to throw a typed error here
// than to fail silently inside imageCompression.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const
const ALLOWED_DOCUMENT_TYPES = ['application/pdf'] as const

const BUCKET = 'board-images'

/** Abort an upload that sends no bytes for this long. Idle time, not total. */
const STALL_TIMEOUT_MS = 60_000

/**
 * Deadline for the response AFTER the body has been handed to the network
 * stack. Deliberately generous: `upload.onprogress` counts bytes given to the
 * socket, not bytes the server received, so this window covers send-buffer
 * drain (megabytes, minutes on a slow uplink) plus the server-side commit — and
 * no progress events fire during either. Bounding the hang is the goal; being
 * tight here would abort healthy uploads at 100%.
 */
const RESPONSE_TIMEOUT_MS = 5 * 60_000

export interface DirectUploadResult {
  fullUrl: string
  thumbnailUrl: string
  storagePath: string
  thumbnailPath?: string
}

export interface DirectUploadOptions {
  /**
   * `loaded`/`total` are byte counts. They arrive `undefined` on transfers that
   * cannot report incrementally — images and PDFs go through the plain SDK
   * upload, which exposes no progress — so treat their absence as "no byte
   * detail", not as a zero-length file.
   */
  onProgress?: (pct: number, loaded?: number, total?: number) => void
  /**
   * When true, the main image upload uses the original file as-is and skips
   * the browser-image-compression round-trip. Thumb generation still runs.
   * Intended for sources that are already controlled-quality JPEGs at the
   * right dimensions (e.g. PDF pages rasterized via pdfToImage.ts) — running
   * them through imageCompression is a decode+re-encode no-op. Phone-camera
   * images must NOT set this — they need the 2400px / q0.85 main pass.
   */
  skipMainCompression?: boolean
}

export interface DirectUploadState {
  uploading: boolean
  error: string | null
  progress: number
  /**
   * Bytes sent / total for the current upload. Both 0 when the transfer can't
   * report incrementally (images and PDFs go through the plain SDK upload), so
   * treat `total === 0` as "no byte detail available" rather than "empty file".
   */
  loadedBytes: number
  totalBytes: number
}

/**
 * Upload a file to a pre-signed Storage URL via XMLHttpRequest so the transfer
 * can report progress.
 *
 * supabase-js v2 uploads through `fetch`, which cannot observe upload progress
 * — there is no `onUploadProgress` on the storage client at all. Minting a
 * signed upload URL and driving it with XHR is the only way to get
 * `upload.onprogress`. Authorization is unchanged: `createSignedUploadUrl` runs
 * under the caller's session, so the same board-images INSERT policy that
 * governs a direct upload governs the signing.
 *
 * Body and headers mirror `uploadToSignedUrl`'s raw-body branch (explicit
 * content-type rather than multipart), so the stored object keeps the
 * deterministic MIME we derive from the extension instead of whatever the
 * browser guessed for the File.
 */
async function uploadToSignedUrlWithProgress(
  path: string,
  file: File,
  contentType: string,
  onProgress: (pct: number, loaded: number, total: number) => void,
): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) {
    throw new Error(`Could not start upload: ${error?.message ?? 'no signed URL returned'}`)
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // Watchdog on IDLE time, not total duration: a 40 MB file on a slow link
    // legitimately takes minutes, so xhr.timeout (which bounds the whole
    // request) would kill real uploads. Without any watchdog a connection that
    // stalls without resetting never fires load or error, the promise never
    // settles, and the button stays disabled at a frozen percentage forever —
    // the exact state this phase exists to remove.
    //
    // It runs in two phases because progress events stop once the body is
    // handed off: idle-timeout while bytes are moving, then a single generous
    // deadline for drain + server commit. Using the idle timeout for that
    // second phase would abort healthy large uploads at 100%.
    let abortReason: 'stall' | 'response' | null = null
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog)
      watchdog = undefined
    }
    const armWatchdog = (ms: number, reason: 'stall' | 'response') => {
      clearWatchdog()
      watchdog = setTimeout(() => {
        abortReason = reason
        xhr.abort()
      }, ms)
    }

    xhr.open('PUT', data.signedUrl, true)
    xhr.setRequestHeader('content-type', contentType)
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (evt) => {
      armWatchdog(STALL_TIMEOUT_MS, 'stall')
      // lengthComputable is false for chunked/unknown-length bodies; reporting
      // a percentage from a zero total would show NaN%.
      if (!evt.lengthComputable || evt.total <= 0) return
      onProgress(Math.round((evt.loaded / evt.total) * 100), evt.loaded, evt.total)
    }
    // Body fully handed to the network stack — no further progress events.
    // MUST stay assigned before send(): the browser decides whether to fire
    // upload events at all from the listeners present at send() time. Move this
    // after send() and phase 2 never arms, leaving the 60s idle timer live
    // through the commit — i.e. healthy large uploads aborted at 100%.
    xhr.upload.onload = () => armWatchdog(RESPONSE_TIMEOUT_MS, 'response')
    xhr.onload = () => {
      clearWatchdog()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Storage upload failed (${xhr.status}): ${xhr.responseText || 'no response body'}`))
    }
    xhr.onerror = () => {
      clearWatchdog()
      reject(new Error('Storage upload failed: network error'))
    }
    xhr.onabort = () => {
      clearWatchdog()
      if (abortReason === 'stall') {
        reject(new Error('Upload stalled — no data sent for a while. Check your connection and try again.'))
      } else if (abortReason === 'response') {
        // The bytes may well have landed; the server just never answered in
        // time. Don't imply the upload definitely failed.
        reject(new Error('Timed out waiting for the server to confirm the upload. Refresh to check whether it completed before retrying.'))
      } else {
        reject(new Error('Upload cancelled'))
      }
    }
    armWatchdog(STALL_TIMEOUT_MS, 'stall')
    try {
      xhr.send(file)
    } catch (sendErr) {
      // A synchronous send() throw skips every handler above, so the armed
      // watchdog would outlive the request.
      clearWatchdog()
      reject(sendErr instanceof Error ? sendErr : new Error('Storage upload failed to start'))
    }
  })
}

export function useDirectUpload(): DirectUploadState & {
  upload: (file: File, options?: DirectUploadOptions) => Promise<DirectUploadResult>
} {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [loadedBytes, setLoadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)

  const upload = useCallback(async (
    file: File,
    options?: DirectUploadOptions,
  ): Promise<DirectUploadResult> => {
    // Byte counts are only overwritten when supplied, so the bare report(100)
    // at the end of a model upload doesn't wipe the counter back to "0 / 0" on
    // the final frame. The reset for a fresh upload happens explicitly below.
    const report = (pct: number, loaded?: number, total?: number) => {
      setProgress(pct)
      if (loaded !== undefined) setLoadedBytes(loaded)
      if (total !== undefined) setTotalBytes(total)
      options?.onProgress?.(pct, loaded, total)
    }

    setUploading(true)
    setError(null)
    setProgress(0)
    setLoadedBytes(0)
    setTotalBytes(0)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const userId = user.id

      const ts = Date.now()
      const rand = Math.random().toString(36).substring(7)

      const isImage = (ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)
      const isPdf = (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)
      const modelExt = SUPPORTED_MODEL_EXTENSIONS.find(ext => file.name.toLowerCase().endsWith(ext))
      const isModel = Boolean(modelExt)

      if (!isImage && !isPdf && !isModel) {
        throw new Error(`Unsupported file type: ${file.type}`)
      }

      // Per-format for models: STL (especially ASCII) is far more verbose than
      // the binary formats and carries its own larger cap. Using the flat
      // MAX_MODEL_SIZE_BYTES here rejected STLs the rest of the app accepts.
      const maxBytes = isModel ? maxModelBytesForName(file.name) : MAX_IMAGE_SIZE_BYTES
      if (file.size > maxBytes) {
        const fileMb = (file.size / 1024 / 1024).toFixed(1)
        const capMb = (maxBytes / 1024 / 1024).toFixed(0)
        throw new Error(`File too large: ${fileMb} MB exceeds ${capMb} MB cap`)
      }

      report(0)

      let storagePath: string
      let thumbnailPath: string | undefined
      let uploadBlob: Blob
      let contentType: string
      let thumbBlob: Blob | null = null

      if (isImage) {
        // Caller can opt out of the main compression pass when the source is
        // already a controlled-quality JPEG (e.g. rasterized PDF pages); thumb
        // generation is still a real downsample so it always runs.
        const mainPromise: Promise<Blob> = options?.skipMainCompression
          ? Promise.resolve(file)
          : imageCompression(file, { maxWidthOrHeight: 2400, initialQuality: 0.85, useWebWorker: true })
        const [mainBlob, tbBlob] = await Promise.all([
          mainPromise,
          imageCompression(file, { maxWidthOrHeight: 800, initialQuality: 0.75, useWebWorker: true, fileType: 'image/jpeg' }),
        ])
        uploadBlob = mainBlob
        thumbBlob = tbBlob
        contentType = 'image/jpeg'
        storagePath = `${userId}/${ts}-${rand}.jpg`
        thumbnailPath = `${userId}/${ts}-${rand}-thumb.jpg`
      } else if (isPdf) {
        uploadBlob = file
        contentType = 'application/pdf'
        storagePath = `${userId}/${ts}-${rand}.pdf`
      } else {
        const baseName = file.name.replace(/\.[^.]+$/, '')
        const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
        const ext = modelExt!.slice(1)
        uploadBlob = file
        // Derive the MIME from the EXTENSION, not file.type. Browsers report
        // model formats inconsistently — commonly '' for .stl and .3dm, and
        // occasionally a type the bucket does not allow-list — which surfaces as
        // an opaque storage rejection. Mirrors app/api/upload-model/route.ts so
        // both paths write identical metadata.
        contentType =
          ext === 'glb' ? 'model/gltf-binary'
          : ext === 'gltf' ? 'model/gltf+json'
          : ext === 'stl' ? 'model/stl'
          : 'application/octet-stream' // .3dm has no standard MIME
        storagePath = `${userId}/models/${ts}-${rand}-${safeName}.${ext}`
      }

      // Models are the only files here that can be tens of MB — images are
      // compressed first and PDFs are rasterized — so they are the only ones
      // that read as frozen without incremental progress. They take the signed
      // URL + XHR path; images and PDFs keep the plain SDK upload rather than
      // re-routing the app's most heavily used pipeline for no benefit.
      // TODO: replace with TUS resumable upload for per-chunk progress fidelity
      if (isModel) {
        await uploadToSignedUrlWithProgress(storagePath, file, contentType, report)
      } else {
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, uploadBlob, { contentType, upsert: false })
        if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)
      }

      if (thumbBlob && thumbnailPath) {
        const { error: thumbErr } = await supabase.storage
          .from(BUCKET)
          .upload(thumbnailPath, thumbBlob, { contentType: 'image/jpeg', upsert: false })
        if (thumbErr) {
          await supabase.storage.from(BUCKET).remove([storagePath])
          throw new Error(`Thumbnail upload failed: ${thumbErr.message}`)
        }
      }

      report(100)

      const { data: fullUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
      const fullUrl = fullUrlData.publicUrl

      let thumbnailUrl = fullUrl
      if (thumbnailPath) {
        const { data: thumbUrlData } = supabase.storage.from(BUCKET).getPublicUrl(thumbnailPath)
        thumbnailUrl = thumbUrlData.publicUrl
      }

      return { fullUrl, thumbnailUrl, storagePath, thumbnailPath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setError(msg)
      throw err
    } finally {
      setUploading(false)
    }
  }, [])

  return { upload, uploading, error, progress, loadedBytes, totalBytes }
}
