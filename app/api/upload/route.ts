import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }
    
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    
    const file = formData.get('image') as File | null
    const rawWorkspaceId = (formData.get('workspaceId') ?? formData.get('studioId')) as string | null
    const workspaceId = (rawWorkspaceId && String(rawWorkspaceId).trim() && String(rawWorkspaceId) !== 'undefined') ? String(rawWorkspaceId).trim() : null
    const rawStudentName = formData.get('studentName') as string | null
    const studentName = (rawStudentName && String(rawStudentName).trim()) ? String(rawStudentName).trim() : (session?.user?.user_metadata?.email?.split('@')[0] || 'Uploaded Board')
    const studentEmail = formData.get('studentEmail') as string
    const rawTitle = formData.get('title') as string | null
    const title = (rawTitle && String(rawTitle).trim()) ? String(rawTitle).trim() : 'Untitled Board'
    const description = formData.get('description') as string
    const tags = formData.get('tags') as string
    
    // Owner information (from authenticated user)
    const ownerName = formData.get('ownerName') as string | null || session.user.user_metadata?.email?.split('@')[0] || 'User'
    const ownerColor = formData.get('ownerColor') as string | null
    
    // Dimensions for aspect ratio preservation
    const originalWidth = formData.get('originalWidth') as string | null
    const originalHeight = formData.get('originalHeight') as string | null
    const aspectRatio = formData.get('aspectRatio') as string | null
    // Physical dimensions in inches
    const physicalWidth = formData.get('physicalWidth') as string | null
    const physicalHeight = formData.get('physicalHeight') as string | null
    
    if (physicalWidth && physicalHeight) {
      console.log(`📐 [API Upload] Received physical dimensions: ${physicalWidth}" x ${physicalHeight}"`)
    } else {
      console.log(`⚠️ [API Upload] No physical dimensions provided for ${title}`)
    }
    
    // Optional position data (0-100 percentage; 50,50 = center of wall)
    const wallIndex = formData.get('position_wall_index')
    const posX = formData.get('position_x')
    const posY = formData.get('position_y')
    const positionWidth = formData.get('position_width')
    const positionHeight = formData.get('position_height')
    const positionSide = formData.get('position_side') as string | null

    const hasWall = wallIndex != null && wallIndex !== ''
    const center = 50
    const positionX =
      hasWall && (posX == null || posX === '')
        ? center
        : posX != null && posX !== ''
          ? parseFloat(posX as string)
          : null
    const positionY =
      hasWall && (posY == null || posY === '')
        ? center
        : posY != null && posY !== ''
          ? parseFloat(posY as string)
          : null

    const missing: string[] = []
    if (!file || (file && typeof file.size === 'number' && file.size === 0)) missing.push('image')
    if (!workspaceId) missing.push('workspaceId')
    if (missing.length > 0) {
      console.error('❌ [API Upload] Missing required fields:', missing)
      return NextResponse.json(
        { error: 'Missing required fields', missing },
        { status: 400 }
      )
    }

    // Validate file size (25MB limit so typical phone photos can upload)
    const maxSize = 25 * 1024 * 1024 // 25MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File size exceeds 25MB limit' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only JPEG, PNG, WebP, and PDF are allowed' }, { status: 400 })
    }

    // Upload file to Supabase Storage
    const ext = file.name.split('.').pop() || 'jpg'
    const timestamp = Date.now()
    const filename = `${userId}/${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`
    // File path should NOT include bucket name - just the path within the bucket
    const filePath = filename

    // Convert File to ArrayBuffer then to Uint8Array for Supabase
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('board-images')
      .upload(filePath, uint8Array, {
        contentType: file.type,
        upsert: false, // Don't overwrite existing files
      })

    if (uploadError) {
      console.error('Error uploading to Supabase Storage:', uploadError)
      return NextResponse.json({ 
        error: 'Failed to upload image', 
        details: uploadError.message || uploadError 
      }, { status: 500 })
    }

    // Get public URL for the uploaded image
    const { data: urlData } = supabase.storage
      .from('board-images')
      .getPublicUrl(filePath)

    const imageUrl = urlData.publicUrl

    // Save board to Supabase
    const boardId = `board-${timestamp}`
    const boardData = {
      id: boardId,
      workspace_id: workspaceId,
      owner_id: userId,
      owner_name: ownerName,
      owner_color: ownerColor || undefined,
      student_name: studentName,
      student_email: studentEmail || null,
      title,
      description: description || null,
      thumbnail_url: imageUrl, // Use Supabase Storage URL
      full_image_url: imageUrl, // Use Supabase Storage URL
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      uploaded_at: new Date().toISOString(),
      position_wall_index: wallIndex ? parseInt(wallIndex as string) : null,
      position_x: positionX,
      position_y: positionY,
      position_width: positionWidth ? parseFloat(positionWidth as string) : null,
      position_height: positionHeight ? parseFloat(positionHeight as string) : null,
      position_side: positionSide && (String(positionSide).toLowerCase() === 'back' || String(positionSide).toLowerCase() === 'front') ? String(positionSide).toLowerCase() : null,
      original_width: originalWidth ? parseInt(originalWidth) : null,
      original_height: originalHeight ? parseInt(originalHeight) : null,
      aspect_ratio: aspectRatio ? parseFloat(aspectRatio) : null,
      physical_width: physicalWidth ? parseFloat(physicalWidth) : null,
      physical_height: physicalHeight ? parseFloat(physicalHeight) : null,
    }
    
    if (boardData.physical_width && boardData.physical_height) {
      console.log(`💾 [API Upload] Saving physical dimensions to DB: ${boardData.physical_width}" x ${boardData.physical_height}"`)
    }

    const { data: savedBoard, error: dbError } = await supabase
      .from('boards')
      .insert(boardData)
      .select()
      .single()

    if (dbError) {
      console.error('Error saving board to database:', dbError)
      return NextResponse.json({ 
        error: 'Failed to save board', 
        details: dbError.message || dbError 
      }, { status: 500 })
    }

    // Transform to frontend format
    const board = {
      id: savedBoard.id,
      studioId: savedBoard.workspace_id, // Keep for backward compatibility
      workspaceId: savedBoard.workspace_id,
      studentName: savedBoard.student_name,
      studentEmail: savedBoard.student_email,
      title: savedBoard.title,
      description: savedBoard.description,
      thumbnailUrl: savedBoard.thumbnail_url,
      fullImageUrl: savedBoard.full_image_url,
      tags: savedBoard.tags || [],
      uploadedAt: savedBoard.uploaded_at,
      position: (savedBoard.position_wall_index !== null && savedBoard.position_x !== null && savedBoard.position_y !== null) ? {
        wallIndex: savedBoard.position_wall_index,
        x: parseFloat(savedBoard.position_x),
        y: parseFloat(savedBoard.position_y),
        width: savedBoard.position_width ? parseFloat(savedBoard.position_width) : undefined,
        height: savedBoard.position_height ? parseFloat(savedBoard.position_height) : undefined,
        side: savedBoard.position_side || 'front',
      } : undefined,
      ownerId: savedBoard.owner_id,
      ownerName: savedBoard.owner_name,
      ownerColor: savedBoard.owner_color,
      originalWidth: savedBoard.original_width,
      originalHeight: savedBoard.original_height,
      aspectRatio: savedBoard.aspect_ratio ? parseFloat(savedBoard.aspect_ratio) : undefined,
      physicalWidth: savedBoard.physical_width ? parseFloat(savedBoard.physical_width) : undefined,
      physicalHeight: savedBoard.physical_height ? parseFloat(savedBoard.physical_height) : undefined,
    }

    console.log('✅ Board uploaded and saved to database:', boardId)
    return NextResponse.json({ success: true, board })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}