'use client'

import { flushSync } from 'react-dom'
import { Board } from '@/types'
import { generateOwnerColor } from '@/lib/ownerColors'
import { toast } from '@/lib/toast'

interface UploadOptions {
  studioId: string
  user: any
  editingWall: number | null
  editingWallDimensions: { width: number; height: number } | null
  editingWallSide?: 'front' | 'back'
  onBoardUpdate: () => Promise<void>
  addTempBoard: (board: Board, blobUrl: string) => void
  replaceTempBoard: (tempId: string, realBoard: Board) => void
  removeTempBoard: (tempId: string) => void
  setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number }>>>
  placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number }>>
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
  formData.append('workspaceId', options.studioId)
  formData.append('title', options.title || 'Untitled Board')
  formData.append('studentName', options.user?.fullName || options.user?.firstName || 'Uploaded Board')
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
    studioId: options.studioId,
    title: options.title,
    studentName: options.user?.fullName || options.user?.firstName || 'Uploaded Board',
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
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number }>>
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
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number }>>
  }
) => {
  const onCurrentWall = realBoard.position?.wallIndex === editingWall && (realBoard.position?.side || 'front') === editingWallSide
  const boardToUse: Board = onCurrentWall
    ? realBoard
    : {
        ...realBoard,
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
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number }>>
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

const DEFAULT_PLACEHOLDER_ASPECT = 1
const DEFAULT_PLACEHOLDER_SIZE = 0.3
/** API position 50,50 = center of wall (0–100). useBoardState's addTempBoard converts with apiToNormalized so 50→0. */
const CENTER_API = 50 // also used when patching real board position in replaceTempBoardInState

/**
 * Upload a single file and handle optimistic updates.
 * Board appears immediately at center of wall, then upload runs in background.
 */
const uploadFile = async (
  file: File,
  options: UploadOptions
): Promise<{ success: boolean; uploadedBoard?: Board }> => {
  const title = file.name.replace(/\.[^/.]+$/, '')
  let tempBoardId: string | null = null
  let blobUrl: string | null = null

  // Show board on wall immediately at center (no await)
  if (options.editingWall !== null && options.editingWallDimensions) {
    const createdBlobUrl = URL.createObjectURL(file)
    blobUrl = createdBlobUrl
    tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const tempBoard = createTempBoard(tempBoardId, {
      studioId: options.studioId,
      title,
      user: options.user,
      blobUrl: createdBlobUrl,
      width: 100,
      height: 100,
      aspectRatio: DEFAULT_PLACEHOLDER_ASPECT,
      tags: [],
      position: {
        wallIndex: options.editingWall,
        x: CENTER_API,
        y: CENTER_API,
        width: DEFAULT_PLACEHOLDER_SIZE * 100,
        height: DEFAULT_PLACEHOLDER_SIZE * 100,
        side: options.editingWallSide || 'front',
      },
    })
    // Flush so the board appears on the wall before any await (image load, API)
    flushSync(() => {
      addTempBoardToState(
        tempBoard,
        { x: 0, y: 0, width: DEFAULT_PLACEHOLDER_SIZE, height: DEFAULT_PLACEHOLDER_SIZE },
        {
          addTempBoard: options.addTempBoard,
          setPlacedBoards3D: options.setPlacedBoards3D,
          placedBoards3DRef: options.placedBoards3DRef,
          blobUrl: createdBlobUrl,
        }
      )
    })
  }

  const { getImageDimensions } = await import('@/lib/getImageDimensions')
  const { extractImagePhysicalDimensions } = await import('@/lib/extractPhysicalDimensions')

  const dims = await getImageDimensions(file)
  const { widthPercent, heightPercent } = calculateBoardDimensions(
    dims.aspectRatio,
    options.editingWallDimensions
  )

  // Update temp board to correct size (aspect ratio) when dimensions are ready
  if (tempBoardId && options.editingWall !== null) {
    options.setPlacedBoards3D((prev) => {
      const next = new Map(prev)
      const current = next.get(tempBoardId!)
      if (current) next.set(tempBoardId!, { ...current, width: widthPercent, height: heightPercent })
      options.placedBoards3DRef.current = next
      return next
    })
  }

  let physicalWidth: number | undefined
  let physicalHeight: number | undefined
  try {
    const physicalDims = await extractImagePhysicalDimensions(file)
    physicalWidth = physicalDims.physicalWidth
    physicalHeight = physicalDims.physicalHeight
  } catch {
    // optional
  }

  try {
    const formData = createBoardFormData(file, {
      studioId: options.studioId,
      title,
      user: options.user,
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
      isPDF: false,
      physicalWidth,
      physicalHeight,
      position: options.editingWall !== null && options.editingWallDimensions ? {
        wallIndex: options.editingWall,
        x: 0,
        y: 0,
        width: widthPercent,
        height: heightPercent,
        side: options.editingWallSide || 'front',
      } : undefined,
    })

    const response = await fetch('/api/upload', { method: 'POST', body: formData })

    if (!response.ok) {
      const errorText = await response.text()
      let errMsg = errorText || `Upload failed (${response.status})`
      try {
        const parsed = JSON.parse(errorText)
        if (parsed.error) errMsg = parsed.error
        if (parsed.missing?.length) errMsg += ` - missing: ${parsed.missing.join(', ')}`
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
  options: UploadOptions
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
      tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
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
          x: gridPos.x,
          y: gridPos.y,
          width: widthPercent,
          height: heightPercent,
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
      const formData = createBoardFormData(page.imageFile, {
        studioId: options.studioId,
        title: pageTitle,
        user: options.user,
        width: page.width,
        height: page.height,
        aspectRatio: page.aspectRatio,
        isPDF: true,
        physicalWidth: page.physicalWidth,
        physicalHeight: page.physicalHeight,
        position: options.editingWall !== null && options.editingWallDimensions ? {
          wallIndex: options.editingWall,
          x: gridPos.x,
          y: gridPos.y,
          width: widthPercent,
          height: heightPercent,
          side: options.editingWallSide || 'front',
        } : undefined,
      })
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
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
            const result = await uploadPDF(file, options)
            if (result.success) {
              successCount += result.count
            } else {
              failCount++
            }
          } else {
            const result = await uploadFile(file, options)
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
      const result = await uploadFile(file, options)
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
          const result = await uploadPDF(file, options)
          if (result.success) successCount += result.count; else failCount++
        } else {
          const result = await uploadFile(file, options)
          if (result.success) successCount++; else failCount++
        }
      } catch { failCount++ }
    }

    await options.onBoardUpdate()

    if (oversized.length > 0) {
      toast.error(`Files too large (max 50 MB):\n${oversized.join('\n')}`)
    } else if (failCount > 0 && successCount === 0) {
      toast.error('No files could be uploaded.')
    }
  }

  return { handleUpload, uploadFileDirect, uploadFilesDirect }
}

