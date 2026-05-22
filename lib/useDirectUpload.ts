'use client'

import { useState, useCallback } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase } from '@/lib/supabase/client'
import { MAX_MODEL_SIZE_BYTES, SUPPORTED_MODEL_EXTENSIONS } from '@/lib/uploadLimits'

// P3.5 TODO: move these to lib/uploadLimits.ts
const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const
const ALLOWED_DOCUMENT_TYPES = ['application/pdf'] as const

const BUCKET = 'board-images'

export interface DirectUploadResult {
  fullUrl: string
  thumbnailUrl: string
  storagePath: string
  thumbnailPath?: string
}

export interface DirectUploadOptions {
  onProgress?: (pct: number) => void
}

export interface DirectUploadState {
  uploading: boolean
  error: string | null
  progress: number
}

export function useDirectUpload(): DirectUploadState & {
  upload: (file: File, options?: DirectUploadOptions) => Promise<DirectUploadResult>
} {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const upload = useCallback(async (
    file: File,
    options?: DirectUploadOptions,
  ): Promise<DirectUploadResult> => {
    const report = (pct: number) => {
      setProgress(pct)
      options?.onProgress?.(pct)
    }

    setUploading(true)
    setError(null)
    setProgress(0)

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

      const maxBytes = isModel ? MAX_MODEL_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES
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
        const [mainBlob, tbBlob] = await Promise.all([
          imageCompression(file, { maxWidthOrHeight: 2400, initialQuality: 0.85, useWebWorker: true }),
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
        contentType = file.type || 'application/octet-stream'
        storagePath = `${userId}/models/${ts}-${rand}-${safeName}.${ext}`
      }

      // TODO: replace with TUS resumable upload for per-chunk progress fidelity
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, uploadBlob, { contentType, upsert: false })
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

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

  return { upload, uploading, error, progress }
}
