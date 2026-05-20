import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { MAX_MODEL_SIZE_BYTES } from '@/lib/uploadLimits'

function getSafeName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'model'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = supabaseServer()
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
    const isSupportedExt = lowerName.endsWith('.glb') || lowerName.endsWith('.gltf') || lowerName.endsWith('.3dm')
    if (!isSupportedExt) {
      return NextResponse.json({ error: 'Only .glb, .gltf, and .3dm files are supported' }, { status: 400 })
    }

    if (file.size > MAX_MODEL_SIZE_BYTES) {
      return NextResponse.json({ error: 'Model exceeds 10 MB limit' }, { status: 400 })
    }

    const ext = lowerName.endsWith('.glb') ? 'glb' : lowerName.endsWith('.3dm') ? '3dm' : 'gltf'
    const base = getSafeName(file.name)
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const filePath = `${session.user.id}/models/${timestamp}-${random}-${base}.${ext}`

    const bytes = new Uint8Array(await file.arrayBuffer())
    const contentType =
      file.type ||
      (ext === 'glb' ? 'model/gltf-binary' : ext === '3dm' ? 'application/octet-stream' : 'model/gltf+json')

    const { error: uploadError } = await supabase.storage
      .from('board-images')
      .upload(filePath, bytes, {
        contentType,
        upsert: false,
      })

    if (uploadError) {
      console.error('Model upload failed:', uploadError)
      return NextResponse.json({ error: 'Failed to upload model' }, { status: 500 })
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

