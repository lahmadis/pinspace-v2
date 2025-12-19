'use client'

import { Board } from '@/types'
import { generateOwnerColor } from '@/lib/ownerColors'

interface UploadOptions {
  studioId: string
  user: any
  editingWall: number | null
  editingWallDimensions: { width: number; height: number } | null
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
  let widthPercent = 0.30
  const heightPercent = 0.30
  
  if (wallDimensions) {
    const defaultHeightPercent = 0.30
    const wallAspectRatio = wallDimensions.width / wallDimensions.height
    widthPercent = defaultHeightPercent * aspectRatio / wallAspectRatio
    
    const maxWidth = 0.50
    if (widthPercent > maxWidth) {
      widthPercent = maxWidth
    }
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
    position?: { wallIndex: number; x: number; y: number; width: number; height: number }
  }
): FormData => {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('studioId', options.studioId)
  formData.append('title', options.title)
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
    // Convert normalized (-0.5 to 0.5) to percentage (0 to 100)
    formData.append('position_x', ((options.position.x + 0.5) * 100).toString())
    formData.append('position_y', ((options.position.y + 0.5) * 100).toString())
    formData.append('position_width', (options.position.width * 100).toString())
    formData.append('position_height', (options.position.height * 100).toString())
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
    position?: { wallIndex: number; x: number; y: number; width: number; height: number }
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
 * Replace temporary board with real uploaded board
 */
const replaceTempBoardInState = (
  tempId: string,
  realBoard: Board,
  editingWall: number,
  options: {
    replaceTempBoard: (tempId: string, realBoard: Board) => void
    setPlacedBoards3D: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number; width?: number; height?: number }>>>
    placedBoards3DRef: React.MutableRefObject<Map<string, { x: number; y: number; width?: number; height?: number }>>
  }
) => {
  if (realBoard.position?.wallIndex !== editingWall) {
    console.warn(`⚠️ [Upload] Board ${realBoard.id} not on current wall ${editingWall}`)
    return false
  }
  
  options.replaceTempBoard(tempId, realBoard)
  options.setPlacedBoards3D(prev => {
    const newMap = new Map(prev)
    const position = newMap.get(tempId)
    if (position) {
      newMap.delete(tempId)
      newMap.set(realBoard.id, position)
      options.placedBoards3DRef.current = newMap
      console.log(`✅ [Upload] Replaced temp board ${tempId} with real board ${realBoard.id}`)
      return newMap
    } else {
      console.warn(`⚠️ [Upload] Temp board ${tempId} not found in placedBoards3D`)
      return prev
    }
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
  console.log(`🧹 [Upload] Cleaning up temp board ${tempId}`)
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

/**
 * Upload a single file and handle optimistic updates
 */
const uploadFile = async (
  file: File,
  options: UploadOptions
): Promise<{ success: boolean; uploadedBoard?: Board }> => {
  const { getImageDimensions } = await import('@/lib/getImageDimensions')
  const { extractImagePhysicalDimensions } = await import('@/lib/extractPhysicalDimensions')
  
  const dims = await getImageDimensions(file)
  
  // Extract physical dimensions
  let physicalWidth: number | undefined
  let physicalHeight: number | undefined
  try {
    const physicalDims = await extractImagePhysicalDimensions(file)
    physicalWidth = physicalDims.physicalWidth
    physicalHeight = physicalDims.physicalHeight
    console.log(`📐 [Upload] Image physical dimensions extracted: ${physicalWidth.toFixed(2)}" x ${physicalHeight.toFixed(2)}" @ ${physicalDims.dpi} DPI`)
  } catch (error) {
    console.warn('⚠️ Could not extract physical dimensions from image:', error)
  }
  
  const { widthPercent, heightPercent } = calculateBoardDimensions(
    dims.aspectRatio,
    options.editingWallDimensions
  )
  
  // Create temp board if editing a wall
  let tempBoardId: string | null = null
  if (options.editingWall !== null && options.editingWallDimensions) {
    const blobUrl = URL.createObjectURL(file)
    tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const tempBoard = createTempBoard(tempBoardId, {
      studioId: options.studioId,
      title: file.name.replace(/\.[^/.]+$/, ''),
      user: options.user,
      blobUrl,
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
      physicalWidth,
      physicalHeight,
      tags: [],
      position: {
        wallIndex: options.editingWall,
        x: 0,
        y: 0,
        width: widthPercent,
        height: heightPercent,
      }
    })
    
    console.log('📤 [Upload] Adding temp board:', tempBoardId)
    addTempBoardToState(tempBoard, { x: 0, y: 0, width: widthPercent, height: heightPercent }, {
      addTempBoard: options.addTempBoard,
      setPlacedBoards3D: options.setPlacedBoards3D,
      placedBoards3DRef: options.placedBoards3DRef,
      blobUrl,
    })
  }
  
  // Upload to API
  try {
    const formData = createBoardFormData(file, {
      studioId: options.studioId,
      title: file.name.replace(/\.[^/.]+$/, ''),
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
      } : undefined,
    })
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    })
    
    if (!response.ok) {
      const error = await response.text()
      throw new Error(error || 'Upload failed')
    }
    
    const data = await response.json()
    const uploadedBoard = data.board as Board
    
    // Replace temp board with real board
    if (tempBoardId && options.editingWall !== null) {
      if (!replaceTempBoardInState(tempBoardId, uploadedBoard, options.editingWall, {
        replaceTempBoard: options.replaceTempBoard,
        setPlacedBoards3D: options.setPlacedBoards3D,
        placedBoards3DRef: options.placedBoards3DRef,
      })) {
        cleanupTempBoard(tempBoardId, {
          removeTempBoard: options.removeTempBoard,
          setPlacedBoards3D: options.setPlacedBoards3D,
          placedBoards3DRef: options.placedBoards3DRef,
        })
      }
    }
    
    return { success: true, uploadedBoard }
  } catch (error) {
    console.error(`❌ [Upload] Failed to upload ${file.name}:`, error)
    if (tempBoardId) {
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
  
  console.log(`✅ PDF converted to ${pages.length} image(s)`)
  
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
    if (options.editingWall !== null && options.editingWallDimensions) {
      const blobUrl = URL.createObjectURL(page.imageFile)
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
        }
      })
      
      console.log(`📤 [Upload PDF] Adding temp board ${pageIndex + 1}/${pages.length} at grid position (${Math.floor(pageIndex % cols)}, ${Math.floor(pageIndex / cols)}):`, tempBoardId)
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
      const uploadedBoard = data.board as Board
      
      // Replace temp board
      if (tempBoardId && options.editingWall !== null) {
        if (!replaceTempBoardInState(tempBoardId, uploadedBoard, options.editingWall, {
          replaceTempBoard: options.replaceTempBoard,
          setPlacedBoards3D: options.setPlacedBoards3D,
          placedBoards3DRef: options.placedBoards3DRef,
        })) {
          cleanupTempBoard(tempBoardId, {
            removeTempBoard: options.removeTempBoard,
            setPlacedBoards3D: options.setPlacedBoards3D,
            placedBoards3DRef: options.placedBoards3DRef,
          })
        }
      }
      
      successCount++
    } catch (error) {
      console.error(`❌ [Upload PDF] Failed to upload page ${pageIndex + 1}:`, error)
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
    
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return
      
      console.log(`📤 Uploading ${files.length} file(s)...`)
      
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
      let successCount = 0
      let failCount = 0
      
      for (const file of files) {
        if (!validTypes.includes(file.type)) {
          console.warn(`⚠️ Skipping invalid file type: ${file.name}`)
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
          console.error(`❌ Failed to upload ${file.name}:`, error)
          failCount++
        }
      }
      
      // Refresh boards list after all uploads
      await options.onBoardUpdate()
      
      console.log(`✅ Upload complete: ${successCount} successful, ${failCount} failed`)
    }
    
    input.click()
  }
  
  return { handleUpload }
}

