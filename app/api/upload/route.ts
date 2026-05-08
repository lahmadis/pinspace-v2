import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', userId)
      .single()
    const profileName = userProfile?.full_name?.trim() || null

    const formData = await request.formData()

    const file = formData.get('image') as File | null
    const rawWorkspaceId = (formData.get('workspaceId') ?? formData.get('studioId')) as string | null
    const workspaceId = (rawWorkspaceId && String(rawWorkspaceId).trim() && String(rawWorkspaceId) !== 'undefined') ? String(rawWorkspaceId).trim() : null
    const rawStudentName = formData.get('studentName') as string | null
    const studentName = (rawStudentName && String(rawStudentName).trim())
      ? String(rawStudentName).trim()
      : (profileName || session?.user?.user_metadata?.email?.split('@')[0] || 'Uploaded Board')
    const studentEmail = formData.get('studentEmail') as string
    const rawTitle = formData.get('title') as string | null
    const title = (rawTitle && String(rawTitle).trim()) ? String(rawTitle).trim() : 'Untitled Board'
    const description = formData.get('description') as string
    const tags = formData.get('tags') as string

    // Owner information (from authenticated user)
    const ownerName = (formData.get('ownerName') as string | null)?.trim() ||
                      profileName ||
                      session.user.user_metadata?.email?.split('@')[0] ||
                      'User'
    const ownerColor = formData.get('ownerColor') as string | null

    // Dimensions for aspect ratio preservation
    const originalWidth = formData.get('originalWidth') as string | null
    const originalHeight = formData.get('originalHeight') as string | null
    const aspectRatio = formData.get('aspectRatio') as string | null
    // Physical dimensions in inches
    const physicalWidth = formData.get('physicalWidth') as string | null
    const physicalHeight = formData.get('physicalHeight') as string | null

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
    const uploadFile = file as File

    // Validate file size (50MB limit)
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (uploadFile.size > maxSize) {
      return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(uploadFile.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only JPEG, PNG, WebP, and PDF are allowed' }, { status: 400 })
    }

    // Convert File to ArrayBuffer
    const arrayBuffer = await uploadFile.arrayBuffer()
    const inputBuffer = Buffer.from(arrayBuffer)

    // Compress images to mozjpeg (skip for PDFs — handled as pre-converted images).
    // Two outputs: 2400px full for lightbox, 800px thumb for the 3D wall view.
    let uploadBuffer: Buffer = inputBuffer
    let thumbnailBuffer: Buffer | null = null
    let uploadContentType = uploadFile.type
    const isPdf = uploadFile.type === 'application/pdf'

    if (!isPdf) {
      try {
        const [fullJpeg, thumbJpeg] = await Promise.all([
          sharp(inputBuffer)
            .resize({ width: 2400, withoutEnlargement: true })
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer(),
          sharp(inputBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .jpeg({ quality: 75, mozjpeg: true })
            .toBuffer(),
        ])
        uploadBuffer = fullJpeg
        thumbnailBuffer = thumbJpeg
        uploadContentType = 'image/jpeg'
      } catch (compressErr) {
        // Fall back to original if sharp fails (e.g. unsupported format)
        console.warn('Image compression failed, using original:', compressErr)
        uploadBuffer = inputBuffer
        thumbnailBuffer = null
        uploadContentType = uploadFile.type
      }
    }

    // Storage path is decided up-front so we can write the placeholder DB row first.
    // Order: insert pending row → upload to storage → flip row to 'complete'.
    // If storage fails, delete the pending row. If the function dies mid-flight, the
    // orphan is a 'pending' row (filtered out of listings) instead of a leaked storage object.
    const ext = isPdf ? (uploadFile.name.split('.').pop() || 'jpg') : 'jpg'
    const timestamp = Date.now()
    const baseSlug = `${userId}/${timestamp}-${Math.random().toString(36).substring(7)}`
    const filePath = `${baseSlug}.${ext}`
    const thumbnailPath = thumbnailBuffer ? `${baseSlug}-thumb.${ext}` : null
    const boardId = `board-${timestamp}-${Math.random().toString(36).slice(2, 8)}`

    const placeholderData = {
      id: boardId,
      workspace_id: workspaceId,
      owner_id: userId,
      owner_name: ownerName,
      owner_color: ownerColor || undefined,
      student_name: studentName,
      student_email: studentEmail || null,
      title,
      description: description || null,
      thumbnail_url: '',
      full_image_url: '',
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      uploaded_at: new Date().toISOString(),
      upload_status: 'pending',
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

    let { data: pendingBoard, error: insertError } = await supabase
      .from('boards')
      .insert(placeholderData)
      .select()
      .single()

    if (insertError) {
      // Fallback for environments with stricter/misaligned RLS:
      // verify user access explicitly, then insert with service role.
      const admin = supabaseServiceRole()
      const { data: workspace } = await admin
        .from('workspaces')
        .select('owner_id, is_public')
        .eq('id', workspaceId)
        .maybeSingle()

      const isOwner = workspace?.owner_id === userId
      let isMember = false
      if (!isOwner) {
        const { data: membership } = await admin
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .maybeSingle()
        isMember = !!membership
      }

      if (!workspace || (!isOwner && !isMember && !workspace.is_public)) {
        console.error('Upload forbidden after RLS fallback check:', insertError)
        return NextResponse.json(
          { error: 'Not authorized to save board in this workspace' },
          { status: 403 }
        )
      }

      const fallbackInsert = await admin
        .from('boards')
        .insert(placeholderData)
        .select()
        .single()
      pendingBoard = fallbackInsert.data
      insertError = fallbackInsert.error
    }

    if (insertError || !pendingBoard) {
      console.error('Error inserting placeholder board row:', insertError)
      return NextResponse.json({ error: 'Failed to create board record' }, { status: 500 })
    }

    // Upload full image to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('board-images')
      .upload(filePath, uploadBuffer, {
        contentType: uploadContentType,
        upsert: false,
      })

    if (uploadError) {
      console.error('Error uploading to Supabase Storage; rolling back placeholder row:', uploadError)
      const adminCleanup = supabaseServiceRole()
      await adminCleanup.from('boards').delete().eq('id', boardId)
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
    }

    // Upload thumbnail variant (when generated by the sharp pipeline)
    if (thumbnailBuffer && thumbnailPath) {
      const { error: thumbUploadError } = await supabase.storage
        .from('board-images')
        .upload(thumbnailPath, thumbnailBuffer, {
          contentType: uploadContentType,
          upsert: false,
        })

      if (thumbUploadError) {
        console.error('Error uploading thumbnail; rolling back full image and placeholder row:', thumbUploadError)
        const adminCleanup = supabaseServiceRole()
        await adminCleanup.storage.from('board-images').remove([filePath])
        await adminCleanup.from('boards').delete().eq('id', boardId)
        return NextResponse.json({ error: 'Failed to upload thumbnail' }, { status: 500 })
      }
    }

    // Get public URLs (thumbnail falls back to the full image when no variant was generated)
    const { data: urlData } = supabase.storage
      .from('board-images')
      .getPublicUrl(filePath)

    const imageUrl = urlData.publicUrl
    let thumbnailUrl = imageUrl
    if (thumbnailPath) {
      const { data: thumbUrlData } = supabase.storage
        .from('board-images')
        .getPublicUrl(thumbnailPath)
      thumbnailUrl = thumbUrlData.publicUrl
    }

    // Flip placeholder to complete with the real URLs.
    const adminUpdate = supabaseServiceRole()
    const { data: savedBoard, error: dbError } = await adminUpdate
      .from('boards')
      .update({
        thumbnail_url: thumbnailUrl,
        full_image_url: imageUrl,
        upload_status: 'complete',
      })
      .eq('id', boardId)
      .select()
      .single()

    if (dbError || !savedBoard) {
      console.error('Error finalizing board record after storage upload:', dbError)
      // Storage objects exist but the DB couldn't be updated. Best effort cleanup.
      const objectsToRemove = thumbnailPath ? [filePath, thumbnailPath] : [filePath]
      await adminUpdate.storage.from('board-images').remove(objectsToRemove)
      await adminUpdate.from('boards').delete().eq('id', boardId)
      return NextResponse.json({ error: 'Failed to save board' }, { status: 500 })
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

    return NextResponse.json({ success: true, board })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
