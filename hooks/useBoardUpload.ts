'use client'

import { flushSync } from 'react-dom'
import { Board } from '@/types'
import { generateOwnerColor } from '@/lib/ownerColors'
import { toast } from '@/lib/toast'
import { loadTexture } from '@/components/3d/useBoardTexture'
import { useDirectUpload, type DirectUploadResult } from '@/lib/useDirectUpload'

interface UploadOptions {
  /**
   * URL `[id]` segment of the studio page. Post-Phase-6.2b URL flip this is a
   * room id, NOT a workspace id — older code that conflated these two is
   * exactly the bug fixed in this commit. Use options.workspaceId for the
   * `workspaceId` form field; studioId here is kept for legacy fields like
   * the temp board's `studioId` member.
   */
  studioId: string
  /** Phase 6.1 room id; forwarded to /api/upload so the new board lands on the correct room. */
  roomId?: string | null
  /**
   * Workspace id for /api/upload's `workspaceId` form field. Phase 6.2b's URL
   * flip means this is no longer the same value as studioId — it must be
   * resolved separately by the caller (the studio page tracks both in state).
   */
  workspaceId?: string | null
  user: any
  editingWall: number | null
  editingWallDimensions: { width: number; height: number } | null
  editingWallSide?: 'front' | 'back'
  onBoardUpdate: () => Promise<void>
  addTempBoard: (board: Board, blobUrl: string) => void
  replaceTempBoard: (tempId: string, realBoard: Board) => void
  removeTempBoard: (tempId: string) => void
  setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>>
  placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>
}

/**
 * Calculate grid position for PDF pages
 * Returns normalized coordinates (-0.5 to 0.5) and dimensions
 */
const calculateGridPosition = (
  index: number,
  total: number,
  spacingX: number = 0.15,
  spacingY: number = 0.15
): { x: number; y: number; width: number; height: number } => {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  const col = index % cols
  const row = Math.floor(index / cols)
  
  const boardWidth = (1.0 - spacingX * (cols + 1)) / cols
  const boardHeight = (1.0 - spacingY * (rows + 1)) / rows
  const gridX = spacingX + col * (boardWidth + spacingX) + boardWidth / 2 - 0.5
  const gridY = spacingY + row * (boardHeight + spacingY) + boardHeight / 2 - 0.5
  
  return { x: gridX, y: gridY, width: boardWidth, height: boardHeight }
}

/**
 * Calculate board dimensions based on aspect ratio and wall dimensions
 */
const calculateBoardDimensions = (
  aspectRatio: number,
  wallDimensions: { width: number; height: number } | null
): { widthPercent: number; heightPercent: number } => {
  const baseHeightPercent = 0.30
  const maxWidthPercent = 0.50
  const maxHeightPercent = 0.50
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const wallAspectRatio =
    wallDimensions && wallDimensions.width > 0 && wallDimensions.height > 0
      ? wallDimensions.width / wallDimensions.height
      : 1

  // Convert image aspect ratio into wall-normalized percentage dimensions.
  // displayedAR = (width% * wallW) / (height% * wallH)
  let heightPercent = baseHeightPercent
  let widthPercent = (safeAspectRatio * heightPercent) / wallAspectRatio

  // Fit within bounds while keeping aspect ratio locked.
  if (widthPercent > maxWidthPercent) {
    widthPercent = maxWidthPercent
    heightPercent = (widthPercent * wallAspectRatio) / safeAspectRatio
  }
  if (heightPercent > maxHeightPercent) {
    heightPercent = maxHeightPercent
    widthPercent = (safeAspectRatio * heightPercent) / wallAspectRatio
  }

  return { widthPercent, heightPercent }
}

/**
 * Create FormData for board upload
 */
const createBoardFormData = (
  file: File,
  options: {
    studioId: string
    /** Phase 6.1 room id; sent to /api/upload alongside studioId/workspaceId. */
    roomId?: string | null
    /** Workspace id; required by /api/upload. Distinct from studioId post-6.2b. */
    workspaceId?: string | null
    title: string
    user: any
    width: number
    height: number
    aspectRatio: number
    isPDF: boolean
    physicalWidth?: number
    physicalHeight?: number
    position?: { wallIndex: number; x: number; y: number; width: number; height: number; side?: 'front' | 'back' }
  }
): FormData => {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('studioId', options.studioId)
  // Use the explicitly-resolved workspaceId for the API's workspaceId field.
  // Falling back to studioId here would reintroduce the post-6.2b bug where a
  // room id leaked into the workspaceId slot.
  if (options.workspaceId) formData.append('workspaceId', options.workspaceId)
  if (options.roomId) formData.append('roomId', options.roomId)
  formData.append('title', options.title || 'Untitled Board')
  // Only send studentName if Clerk has a real value. Omitting it lets the
  // server fall through to user_profiles.full_name, which is populated by
  // the PinSpace onboarding flow and is the authoritative display name.
  const clerkName = (options.user?.fullName || options.user?.firstName || '').trim()
  if (clerkName) formData.append('studentName', clerkName)
  formData.append('description', options.isPDF ? 'PDF Document' : '')
  formData.append('tags', options.isPDF ? 'pdf' : '')
  formData.append('originalWidth', options.width.toString())
  formData.append('originalHeight', options.height.toString())
  formData.append('aspectRatio', options.aspectRatio.toString())
  
  if (options.physicalWidth && options.physicalHeight) {
    formData.append('physicalWidth', options.physicalWidth.toString())
    formData.append('physicalHeight', options.physicalHeight.toString())
  }
  
  if (options.position) {
    formData.append('position_wall_index', options.position.wallIndex.toString())
    // Convert normalized (-0.5 to 0.5) to percentage (0 to 100). Center of wall = 50, 50.
    const apiX = (options.position.x + 0.5) * 100
    const apiY = (options.position.y + 0.5) * 100
    formData.append('position_x', apiX.toString())
    formData.append('position_y', apiY.toString())
    formData.append('position_width', (options.position.width * 100).toString())
    formData.append('position_height', (options.position.height * 100).toString())
    if (options.position.side) {
      formData.append('position_side', options.position.side)
    }
  }
  
  if (options.user) {
    formData.append('ownerId', options.user.id)
    formData.append('ownerName', options.user.fullName || options.user.firstName || 'Anonymous')
    formData.append('ownerColor', generateOwnerColor(options.user.id))
  }
  
  return formData
}

/**
 * Create temporary board with blob URL for optimistic updates
 */
const createTempBoard = (
  tempId: string,
  options: {
    studioId: string
    title: string
    user: any
    blobUrl: string
    width: number
    height: number
    aspectRatio: number
    physicalWidth?: number
    physicalHeight?: number
    tags: string[]
    position?: { wallIndex: number; x: number; y: number; width: number; height: number; side?: 'front' | 'back' }
  }
): Board => {
  return {
    id: tempId,
    // Stable client-side key for React. Carries onto the real board in
    // replaceTempBoardInState so the DraggableBoard instance is preserved
    // across the id swap and any in-flight gesture's window listeners stay
    // attached. tempId is already unique per upload session, so reuse it.
    localId: tempId,
    studioId: options.studioId,
    title: options.title,
    studentName: options.user?.fullName || options.user?.firstName || '',
    ownerId: options.user?.id,
    ownerName: options.user?.fullName || options.user?.firstName || 'Anonymous',
    thumbnailUrl: options.blobUrl,
    fullImageUrl: options.blobUrl,
    uploadedAt: new Date(),
    tags: options.tags,
    originalWidth: options.width,
    originalHeight: options.height,
    aspectRatio: options.aspectRatio,
    physicalWidth: options.physicalWidth,
    physicalHeight: options.physicalHeight,
    position: options.position,
  }
}

/**
 * Add temporary board to state
 */
const addTempBoardToState = (
  tempBoard: Board,
  position: { x: number; y: number; width: number; height: number },
  options: {
    addTempBoard: (board: Board, blobUrl: string) => void
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>
    blobUrl: string
  }
) => {
  options.addTempBoard(tempBoard, options.blobUrl)
  options.setPlacedBoards3D(prev => {
    const newMap = new Map(prev)
    newMap.set(tempBoard.id, position)
    options.placedBoards3DRef.current = newMap
    return newMap
  })
}

/**
 * Replace temporary board with real uploaded board.
 * If the API returns a board without position (or wrong wall), patch it to current wall + center
 * so the sync effect keeps it visible instead of dropping it.
 */
const replaceTempBoardInState = (
  tempId: string,
  realBoard: Board,
  editingWall: number,
  editingWallSide: 'front' | 'back',
  options: {
    replaceTempBoard: (tempId: string, realBoard: Board) => void
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>
  }
) => {
  const onCurrentWall = realBoard.position?.wallIndex === editingWall && (realBoard.position?.side || 'front') === editingWallSide
  // Carry the temp board's localId onto the real board so the React key
  // doesn't change across the id swap. Without this, <DraggableBoard
  // key={...}> remounts and tears down any in-flight drag/resize gesture's
  // window listeners. tempId itself is the stable identifier — it was
  // assigned as localId in createTempBoard.
  const boardToUse: Board = onCurrentWall
    ? { ...realBoard, localId: tempId }
    : {
        ...realBoard,
        localId: tempId,
        position: {
          wallIndex: editingWall,
          x: CENTER_API,
          y: CENTER_API,
          width: 30,
          height: 30,
          side: editingWallSide,
        },
      }

  options.replaceTempBoard(tempId, boardToUse)
  options.setPlacedBoards3D(prev => {
    const newMap = new Map(prev)
    const position = newMap.get(tempId)
    if (position) {
      newMap.delete(tempId)
      newMap.set(boardToUse.id, position)
      options.placedBoards3DRef.current = newMap
      return newMap
    }
    return prev
  })
  return true
}

/**
 * Clean up temporary board on upload failure
 */
const cleanupTempBoard = (
  tempId: string,
  options: {
    removeTempBoard: (tempId: string) => void
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>>
  }
) => {
  options.removeTempBoard(tempId)
  options.setPlacedBoards3D(prev => {
    const newMap = new Map(prev)
    if (newMap.has(tempId)) {
      newMap.delete(tempId)
      options.placedBoards3DRef.current = newMap
    }
    return newMap
  })
}

/** API position 50,50 = center of wall (0–100). useBoardState's addTempBoard converts with apiToNormalized so 50→0. */
const CENTER_API = 50 // also used when patching real board position in replaceTempBoardInState

/**
 * Upload a single file and handle optimistic updates.
 * Image dimensions are measured client-side BEFORE the temp board is added to state, so
 * the placeholder appears at the correct aspect ratio from frame 1 (no snap/flicker).
 */
const uploadFile = async (
  file: File,
  options: UploadOptions,
  directUpload: (file: File) => Promise<DirectUploadResult>
): Promise<{ success: boolean; uploadedBoard?: Board }> => {
  const title = file.name.replace(/\.[^/.]+$/, '')
  let tempBoardId: string | null = null
  let blobUrl: string | null = null

  const { getImageDimensions } = await import('@/lib/getImageDimensions')

  // Create the blob URL synchronously up-front so we can start loading its texture into the
  // module-level cache in parallel with measuring image dimensions. By the time we commit the
  // temp board to React state, both are done — useBoardTexture will see a cache hit on its very
  // first render and skip the skeleton entirely.
  const earlyBlobUrl = options.editingWall !== null && options.editingWallDimensions
    ? URL.createObjectURL(file)
    : null
  const texturePrewarm = earlyBlobUrl
    ? loadTexture(earlyBlobUrl).catch(() => undefined)
    : Promise.resolve(undefined)

  const dims = await getImageDimensions(file)
  const { widthPercent, heightPercent } = calculateBoardDimensions(
    dims.aspectRatio,
    options.editingWallDimensions
  )

  // Show board on wall with correct dimensions baked in (still optimistic — runs before API call).
  if (options.editingWall !== null && options.editingWallDimensions && earlyBlobUrl) {
    const createdBlobUrl = earlyBlobUrl
    blobUrl = createdBlobUrl
    // Wait for the pre-warm to finish so useBoardTexture sees the resolved cache on first render.
    await texturePrewarm
    tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const tempBoard = createTempBoard(tempBoardId, {
      studioId: options.studioId,
      title,
      user: options.user,
      blobUrl: createdBlobUrl,
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
      tags: [],
      position: {
        wallIndex: options.editingWall,
        x: CENTER_API,
        y: CENTER_API,
        width: widthPercent * 100,
        height: heightPercent * 100,
        side: options.editingWallSide || 'front',
      },
    })
    // Flush so the board appears on the wall before the upload network call.
    flushSync(() => {
      addTempBoardToState(
        tempBoard,
        { x: 0, y: 0, width: widthPercent, height: heightPercent },
        {
          addTempBoard: options.addTempBoard,
          setPlacedBoards3D: options.setPlacedBoards3D,
          placedBoards3DRef: options.placedBoards3DRef,
          blobUrl: createdBlobUrl,
        }
      )
    })
  }

  try {
    const { storagePath, thumbnailPath } = await directUpload(file)

    const clerkName = ((options.user?.fullName || options.user?.firstName || '') as string).trim()
    const boardPayload = {
      workspaceId: options.workspaceId,
      roomId: options.roomId,
      storagePath,
      thumbnailPath,
      ownerColor: generateOwnerColor(options.user?.id ?? ''),
      originalFilename: file.name,
      studentName: clerkName || undefined,
      width: dims.width,
      height: dims.height,
      ...(options.editingWall !== null && options.editingWallDimensions ? {
        position: {
          wallIndex: options.editingWall,
          x: CENTER_API,
          y: CENTER_API,
          widthPercent: widthPercent * 100,
          heightPercent: heightPercent * 100,
          side: options.editingWallSide ?? 'front',
        },
      } : {}),
    }

    const response = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(boardPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errMsg = errorText || `Upload failed (${response.status})`
      try {
        const parsed = JSON.parse(errorText)
        if (parsed.error) errMsg = parsed.error
      } catch {
        // use errMsg as-is
      }
      throw new Error(errMsg)
    }

    const data = await response.json()
    let uploadedBoard = data.board as Board
    // Ensure position.side matches where we actually uploaded (API/DB may omit or default position_side to front)
    const editingSide = options.editingWallSide || 'front'
    if (uploadedBoard?.position && options.editingWall !== null) {
      uploadedBoard = {
        ...uploadedBoard,
        position: { ...uploadedBoard.position, side: editingSide },
      }
    }

    // Pre-warm the cache for the real URLs *before* swapping the temp board out, and AWAIT the
    // pre-warm so the new DraggableBoard mount (keyed by the real board id) finds the texture
    // already in resolvedCache on first render — no skeleton flash, no grey rectangle.
    //
    // During this await, the temp board (keyed by tempBoardId) stays mounted in StudioRoom's
    // render loop and keeps rendering the local blob URL, so the user sees their image the
    // whole time — there's no flash to empty.
    //
    // Promise.allSettled (not .all) so a failed/slow CDN doesn't block the swap forever; a
    // failed load falls through to the existing skeleton path, which is acceptable.
    //
    // Hard 3s timeout guards against pathological CDN stalls: the fallback (timeout fires, swap
    // proceeds, brief skeleton) is still better than the previous always-skeleton behavior.
    const prewarmUrls: string[] = []
    if (uploadedBoard?.thumbnailUrl) prewarmUrls.push(uploadedBoard.thumbnailUrl)
    if (uploadedBoard?.fullImageUrl && uploadedBoard.fullImageUrl !== uploadedBoard.thumbnailUrl) {
      prewarmUrls.push(uploadedBoard.fullImageUrl)
    }
    if (prewarmUrls.length > 0) {
      const prewarm = Promise.allSettled(prewarmUrls.map((u) => loadTexture(u)))
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000))
      await Promise.race([prewarm, timeout])
    }

    if (tempBoardId && options.editingWall !== null) {
      replaceTempBoardInState(
        tempBoardId,
        uploadedBoard,
        options.editingWall,
        editingSide,
        {
          replaceTempBoard: options.replaceTempBoard,
          setPlacedBoards3D: options.setPlacedBoards3D,
          placedBoards3DRef: options.placedBoards3DRef,
        }
      )
    }

    // Blob URL is no longer needed once the real board has a permanent URL
    if (tempBoardId) URL.revokeObjectURL(blobUrl!)

    return { success: true, uploadedBoard }
  } catch (error) {
    console.error(`[Upload] Failed to upload ${file.name}:`, error)
    if (tempBoardId) {
      URL.revokeObjectURL(blobUrl!)
      cleanupTempBoard(tempBoardId, {
        removeTempBoard: options.removeTempBoard,
        setPlacedBoards3D: options.setPlacedBoards3D,
        placedBoards3DRef: options.placedBoards3DRef,
      })
    }
    return { success: false }
  }
}

/**
 * Upload a PDF file with multi-page support
 */
const uploadPDF = async (
  file: File,
  options: UploadOptions,
  directUpload: (file: File) => Promise<DirectUploadResult>
): Promise<{ success: boolean; count: number }> => {
  const { convertPDFToImages } = await import('@/lib/pdfToImage')
  const pages = await convertPDFToImages(file)
  
  // Calculate grid layout
  const cols = Math.ceil(Math.sqrt(pages.length))
  const rows = Math.ceil(pages.length / cols)

  let successCount = 0

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]
    const pageTitle = pages.length > 1
      ? `${file.name.replace('.pdf', '')} - Page ${page.pageNumber}`
      : file.name.replace('.pdf', '')

    const { widthPercent, heightPercent } = calculateBoardDimensions(
      page.aspectRatio,
      options.editingWallDimensions
    )

    const gridPos = calculateGridPosition(pageIndex, pages.length)

    // Create temp board
    let tempBoardId: string | null = null
    let pageBlobUrl: string | null = null
    if (options.editingWall !== null && options.editingWallDimensions) {
      pageBlobUrl = URL.createObjectURL(page.imageFile)
      const blobUrl = pageBlobUrl
      tempBoardId = `temp-${Date.now()}-${pageIndex}-${Math.random().toString(36).substr(2, 9)}`
      
      const tempBoard = createTempBoard(tempBoardId, {
        studioId: options.studioId,
        title: pageTitle,
        user: options.user,
        blobUrl,
        width: page.width,
        height: page.height,
        aspectRatio: page.aspectRatio,
        physicalWidth: page.physicalWidth,
        physicalHeight: page.physicalHeight,
        tags: ['pdf'],
        position: {
          wallIndex: options.editingWall,
          x: (gridPos.x + 0.5) * 100,
          y: (gridPos.y + 0.5) * 100,
          width: widthPercent * 100,
          height: heightPercent * 100,
          side: options.editingWallSide || 'front',
        }
      })
      
      addTempBoardToState(tempBoard, { x: gridPos.x, y: gridPos.y, width: widthPercent, height: heightPercent }, {
        addTempBoard: options.addTempBoard,
        setPlacedBoards3D: options.setPlacedBoards3D,
        placedBoards3DRef: options.placedBoards3DRef,
        blobUrl,
      })
    }
    
    // Upload page
    try {
      const { storagePath, thumbnailPath } = await directUpload(page.imageFile)

      const clerkName = ((options.user?.fullName || options.user?.firstName || '') as string).trim()
      const boardPayload = {
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        storagePath,
        thumbnailPath,
        ownerColor: generateOwnerColor(options.user?.id ?? ''),
        originalFilename: file.name,
        studentName: clerkName || undefined,
        width: page.width,
        height: page.height,
        isPdf: true,
        physicalWidth: page.physicalWidth,
        physicalHeight: page.physicalHeight,
        ...(options.editingWall !== null && options.editingWallDimensions ? {
          position: {
            wallIndex: options.editingWall,
            x: (gridPos.x + 0.5) * 100,
            y: (gridPos.y + 0.5) * 100,
            widthPercent: widthPercent * 100,
            heightPercent: heightPercent * 100,
            side: options.editingWallSide ?? 'front',
          },
        } : {}),
      }

      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(boardPayload),
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`)
      }

      const data = await response.json()
      let uploadedBoard = data.board as Board
      const editingSide = options.editingWallSide || 'front'
      if (uploadedBoard?.position && options.editingWall !== null) {
        uploadedBoard = { ...uploadedBoard, position: { ...uploadedBoard.position, side: editingSide } }
      }

      // Pre-warm CDN textures before swapping so the real board mount finds them in resolvedCache
      // and skips the gray skeleton. Same pattern as uploadFile — see comments there for rationale.
      const prewarmUrls: string[] = []
      if (uploadedBoard?.thumbnailUrl) prewarmUrls.push(uploadedBoard.thumbnailUrl)
      if (uploadedBoard?.fullImageUrl && uploadedBoard.fullImageUrl !== uploadedBoard.thumbnailUrl) {
        prewarmUrls.push(uploadedBoard.fullImageUrl)
      }
      if (prewarmUrls.length > 0) {
        const prewarm = Promise.allSettled(prewarmUrls.map((u) => loadTexture(u)))
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000))
        await Promise.race([prewarm, timeout])
      }

      // Replace temp board (always replace; position patched to current wall if API omitted it)
      if (tempBoardId && options.editingWall !== null) {
        replaceTempBoardInState(
          tempBoardId,
          uploadedBoard,
          options.editingWall,
          editingSide,
          {
            replaceTempBoard: options.replaceTempBoard,
            setPlacedBoards3D: options.setPlacedBoards3D,
            placedBoards3DRef: options.placedBoards3DRef,
          }
        )
      }

      // Blob URL no longer needed once the real board has a permanent URL
      if (pageBlobUrl) URL.revokeObjectURL(pageBlobUrl)

      successCount++
    } catch (error) {
      console.error(`[Upload PDF] Failed to upload page ${pageIndex + 1}:`, error)
      const errMsg = error instanceof Error ? error.message : 'Upload failed'
      toast.error(`Page ${pageIndex + 1} of ${file.name}: ${errMsg}`)
      if (pageBlobUrl) URL.revokeObjectURL(pageBlobUrl)
      if (tempBoardId) {
        cleanupTempBoard(tempBoardId, {
          removeTempBoard: options.removeTempBoard,
          setPlacedBoards3D: options.setPlacedBoards3D,
          placedBoards3DRef: options.placedBoards3DRef,
        })
      }
    }
  }
  
  return { success: successCount > 0, count: successCount }
}

/**
 * Hook for handling board uploads with optimistic updates
 */
export const useBoardUpload = (options: UploadOptions) => {
  const { upload } = useDirectUpload()

  const handleUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.jpg,.jpeg,.png,.pdf'
    input.multiple = true
    
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB (must match API)
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return
      
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
      let successCount = 0
      let failCount = 0
      const oversized: string[] = []

      for (const file of files) {
        if (!validTypes.includes(file.type)) {
          failCount++
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          const mb = (file.size / (1024 * 1024)).toFixed(1)
          oversized.push(`${file.name} (${mb} MB)`)
          failCount++
          continue
        }
        
        try {
          if (file.type === 'application/pdf') {
            const result = await uploadPDF(file, options, upload)
            if (result.success) {
              successCount += result.count
            } else {
              failCount++
            }
          } else {
            const result = await uploadFile(file, options, upload)
            if (result.success) {
              successCount++
            } else {
              failCount++
            }
          }
        } catch (error) {
          console.error(`[Upload] Failed to upload ${file.name}:`, error)
          failCount++
        }
      }

      // Refresh boards list after all uploads
      await options.onBoardUpdate()

      if (oversized.length > 0) {
        toast.error(`These files are too large (max 50 MB):\n${oversized.join('\n')}`)
      }
      const totalAttempted = successCount + failCount
      if (totalAttempted > 1 && successCount > 0 && failCount > 0) {
        toast.warning(`Uploaded ${successCount} of ${totalAttempted}. ${failCount} failed.`)
      } else if (failCount > 0 && successCount === 0 && oversized.length === 0) {
        toast.error('No files could be uploaded.')
      }
    }

    input.click()
  }

  /** Upload a single image file (e.g. from clipboard paste). Only images; PDFs use the file picker. */
  const uploadFileDirect = async (file: File): Promise<boolean> => {
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png']
    if (!validImageTypes.includes(file.type)) return false
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
    if (file.size > MAX_FILE_SIZE) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      toast.error(`${file.name} is too large (${mb} MB). Maximum size is 50 MB.`)
      return false
    }
    try {
      const result = await uploadFile(file, options, upload)
      if (result.success) await options.onBoardUpdate()
      return result.success
    } catch {
      return false
    }
  }

  /** Upload multiple files (e.g. from drag-and-drop). Supports images + PDFs. */
  const uploadFilesDirect = async (files: File[]): Promise<void> => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
    const MAX_FILE_SIZE = 50 * 1024 * 1024
    let successCount = 0
    let failCount = 0
    const oversized: string[] = []

    for (const file of files) {
      if (!validTypes.includes(file.type)) { failCount++; continue }
      if (file.size > MAX_FILE_SIZE) {
        const mb = (file.size / (1024 * 1024)).toFixed(1)
        oversized.push(`${file.name} (${mb} MB)`)
        failCount++
        continue
      }
      try {
        if (file.type === 'application/pdf') {
          const result = await uploadPDF(file, options, upload)
          if (result.success) successCount += result.count; else failCount++
        } else {
          const result = await uploadFile(file, options, upload)
          if (result.success) successCount++; else failCount++
        }
      } catch { failCount++ }
    }

    await options.onBoardUpdate()

    if (oversized.length > 0) {
      toast.error(`Files too large (max 50 MB):\n${oversized.join('\n')}`)
    }
    const totalAttempted = successCount + failCount
    if (totalAttempted > 1 && successCount > 0 && failCount > 0) {
      toast.warning(`Uploaded ${successCount} of ${totalAttempted}. ${failCount} failed.`)
    } else if (failCount > 0 && successCount === 0 && oversized.length === 0) {
      toast.error('No files could be uploaded.')
    }
  }

  return { handleUpload, uploadFileDirect, uploadFilesDirect }
}

