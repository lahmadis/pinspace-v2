'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import Loading from '@/components/Loading'
import { Upload } from 'lucide-react'
import { toast } from '@/lib/toast'
import { maxModelBytesForName } from '@/lib/uploadLimits'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Input } from '@/components/ui'

// The three.js viewer touches renderer internals during module evaluation, so it
// must stay client-only even though the surrounding utility is a Client Component.
const ModelViewer = dynamic(() => import('@/components/3d/ModelViewer'), {
  ssr: false,
  loading: () => <Loading message="Loading model…" />,
})

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
      // Route search parameters are the external source of truth for this utility.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="flex min-h-dvh flex-col bg-background">
      <PageHeader
        eyebrow="Utility"
        title="3D model viewer"
        description="Preview a local GLB, GLTF, 3DM, or STL model, or load one from a trusted URL."
        actions={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => router.back()} aria-label="Back to previous page">← Back</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb,.gltf,.3dm,.stl"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              variant="ghost"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload model
            </Button>
            <label htmlFor="model-url" className="sr-only">Model URL</label>
            <Input
              id="model-url"
              type="text"
              placeholder="Or paste a URL (e.g. /models/example.glb)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
              className="min-w-[min(15rem,70vw)] flex-1 sm:max-w-md"
            />
            <Button
              type="button"
              onClick={handleLoad}
              disabled={!urlInput.trim()}
            >
              Load URL
            </Button>
          </div>
        }
      />

      {/* Viewer area */}
      <main className="flex-1 min-h-0 relative">
        {!hasUrl ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background-lighter/50">
            <div className="text-center max-w-md px-6">
              <p className="text-text-muted mb-4">
                Choose <strong>Upload model</strong> to preview a local file, or enter a URL and choose Load URL.
              </p>
              <p className="text-sm text-text-muted">
                You can also open this page with <code className="text-sm bg-background-light px-1 rounded">?url=/models/yourfile.glb</code>
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0">
            <div className="h-full w-full bg-primary-muted">
              <ModelViewer modelUrl={activeUrl} />
            </div>
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
