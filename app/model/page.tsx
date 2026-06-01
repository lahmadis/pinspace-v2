'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import ModelViewer from '@/components/3d/ModelViewer'
import Loading from '@/components/Loading'
import { Upload } from 'lucide-react'
import { toast } from '@/lib/toast'
import { maxModelBytesForName } from '@/lib/uploadLimits'

function ModelPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const urlFromQuery =
    searchParams.get('url') ?? searchParams.get('model') ?? ''
  const [urlInput, setUrlInput] = useState(urlFromQuery || '')
  const [activeUrl, setActiveUrl] = useState(urlFromQuery || '')
  const lastObjectUrlRef = useRef<string | null>(null)

  // Revoke previous blob URL when it changes to avoid memory leaks
  useEffect(() => {
    return () => {
      if (lastObjectUrlRef.current) {
        URL.revokeObjectURL(lastObjectUrlRef.current)
        lastObjectUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (urlFromQuery && urlFromQuery !== activeUrl && !urlFromQuery.startsWith('blob:')) {
      if (lastObjectUrlRef.current) {
        URL.revokeObjectURL(lastObjectUrlRef.current)
        lastObjectUrlRef.current = null
      }
      setUrlInput(urlFromQuery)
      setActiveUrl(urlFromQuery)
    }
  }, [urlFromQuery, activeUrl])

  const handleLoad = useCallback(() => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    if (lastObjectUrlRef.current) {
      URL.revokeObjectURL(lastObjectUrlRef.current)
      lastObjectUrlRef.current = null
    }
    setActiveUrl(trimmed)
    const params = new URLSearchParams(searchParams.toString())
    params.set('url', trimmed)
    router.replace(`/model?${params.toString()}`, { scroll: false })
  }, [urlInput, router, searchParams])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const lower = file.name.toLowerCase()
    const isSupportedExt = lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.endsWith('.3dm') || lower.endsWith('.stl')
    if (!isSupportedExt) {
      toast.error('Please select a .glb, .gltf, .3dm, or .stl file.')
      return
    }
    const maxBytes = maxModelBytesForName(lower)
    if (file.size > maxBytes) {
      const capMb = Math.round(maxBytes / (1024 * 1024))
      toast.error(`Model must be under ${capMb} MB.`)
      return
    }
    if (lastObjectUrlRef.current) {
      URL.revokeObjectURL(lastObjectUrlRef.current)
      lastObjectUrlRef.current = null
    }
    const objectUrl = URL.createObjectURL(file)
    lastObjectUrlRef.current = objectUrl
    setUrlInput('')
    setActiveUrl(objectUrl)
    e.target.value = ''
  }, [])

  const hasUrl = activeUrl.length > 0

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <motion.header
        className="flex-none z-50 bg-white/95 backdrop-blur-sm border-b border-border shadow-sm"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-background-lighter rounded-lg transition-colors"
              aria-label="Back"
            >
              <svg
                className="w-5 h-5 text-text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <h1 className="text-lg font-semibold text-text-primary">
              3D Model Viewer
            </h1>
          </div>

          <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb,.gltf,.3dm,.stl"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-background-lighter hover:bg-background-light text-text-primary rounded-lg text-sm transition-colors whitespace-nowrap flex items-center gap-2 border border-border"
            >
              <Upload className="w-4 h-4" />
              Upload GLB
            </button>
            <input
              type="text"
              placeholder="Or paste a URL (e.g. /models/example.glb)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
              className="flex-1 min-w-[200px] max-w-md px-3 py-2 border border-border rounded-lg text-sm bg-white text-text-primary placeholder:text-text-muted"
            />
            <button
              onClick={handleLoad}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              Load URL
            </button>
          </div>
        </div>
      </motion.header>

      {/* Viewer area */}
      <main className="flex-1 min-h-0 relative">
        {!hasUrl ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background-lighter/50">
            <div className="text-center max-w-md px-6">
              <p className="text-text-muted mb-4">
                Click <strong>Upload GLB</strong> to choose a .glb or .gltf file from your computer, or enter a URL and click Load URL.
              </p>
              <p className="text-sm text-text-muted">
                You can also open this page with <code className="text-sm bg-white px-1 rounded">?url=/models/yourfile.glb</code>
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0">
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center bg-[#D8DEFF]">
                  <Loading message="Loading model..." />
                </div>
              }
            >
              <ModelViewer modelUrl={activeUrl} />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  )
}

export default function ModelPage() {
  return (
    <Suspense fallback={<Loading message="Loading..." />}>
      <ModelPageContent />
    </Suspense>
  )
}
