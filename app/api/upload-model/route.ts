import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { maxModelBytesForName, SUPPORTED_MODEL_EXTENSIONS } from '@/lib/uploadLimits'

function getSafeName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'model'
}

/**
 * NOT the app's model-upload path any more — the floor editor uploads straight
 * from the browser to Storage via lib/useDirectUpload.ts.
 *
 * DO NOT re-wire a UI to this route without reading this first: it is a Vercel
 * serverless function, so its request body is capped at ~4.5 MB by the
 * platform. Anything larger is rejected before this handler executes, which
 * means the `maxModelBytesForName` check below (40 MB, or 50 MB for STL) can
 * never actually be the binding limit in production. It reads as if large
 * uploads are supported here; they are not.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('model') as File | null
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'Missing model file' }, { status: 400 })
    }

    const lowerName = file.name.toLowerCase()
    const isSupportedExt = SUPPORTED_MODEL_EXTENSIONS.some(e => lowerName.endsWith(e))
    if (!isSupportedExt) {
      return NextResponse.json({ error: 'Only .glb, .gltf, .3dm, and .stl files are supported' }, { status: 400 })
    }

    const maxBytes = maxModelBytesForName(lowerName)
    if (file.size > maxBytes) {
      const capMb = Math.round(maxBytes / (1024 * 1024))
      const fileMb = (file.size / (1024 * 1024)).toFixed(1)
      return NextResponse.json(
        { error: `Model is too large: ${fileMb} MB exceeds the ${capMb} MB limit` },
        { status: 400 }
      )
    }

    const ext = lowerName.endsWith('.glb') ? 'glb'
      : lowerName.endsWith('.3dm') ? '3dm'
      : lowerName.endsWith('.stl') ? 'stl'
      : 'gltf'
    const base = getSafeName(file.name)
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const filePath = `${session.user.id}/models/${timestamp}-${random}-${base}.${ext}`

    const bytes = new Uint8Array(await file.arrayBuffer())
    // Set contentType deterministically from the extension rather than trusting
    // the browser-supplied file.type (often empty or octet-stream), so Storage
    // always receives a MIME the bucket accepts. All four are allow-listed on
    // the board-images bucket. .3dm has no standard MIME → octet-stream.
    const contentType =
      ext === 'glb' ? 'model/gltf-binary'
      : ext === 'stl' ? 'model/stl'
      : ext === '3dm' ? 'application/octet-stream'
      : 'model/gltf+json' // gltf

    const { error: uploadError } = await supabase.storage
      .from('board-images')
      .upload(filePath, bytes, {
        contentType,
        upsert: false,
      })

    if (uploadError) {
      console.error('Model upload failed:', uploadError)
      // Surface the real storage reason (mime/size/status) so the client can
      // show something actionable instead of a generic failure. These messages
      // describe the request, not secrets.
      const detail = uploadError.message || 'unknown storage error'
      const statusCode = (uploadError as { statusCode?: string | number }).statusCode
      return NextResponse.json(
        { error: `Failed to upload model (${contentType}): ${detail}${statusCode ? ` [status ${statusCode}]` : ''}` },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from('board-images')
      .getPublicUrl(filePath)

    return NextResponse.json({
      success: true,
      url: publicUrlData.publicUrl,
    })
  } catch (error) {
    console.error('Upload model API error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
