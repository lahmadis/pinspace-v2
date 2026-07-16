'use client'

import { flushSync } from 'react-dom'
import { Board } from '@/types'
import { generateOwnerColor } from '@/lib/ownerColors'
import { toast } from '@/lib/toast'
import { loadTexture } from '@/components/3d/useBoardTexture'
import { useDirectUpload, type DirectUploadResult, type DirectUploadOptions } from '@/lib/useDirectUpload'
import { MAX_IMAGE_SIZE_BYTES } from '@/lib/uploadLimits'
import { boardSizeInchesFromSource } from '@/lib/boardDimensions'
// Static import is safe: pdfUtils is dependency-free string/extension helpers.
// The rasterizer itself (lib/pdfToImage.ts, which pulls PDF.js) stays a dynamic
// import below so it never lands in the main bundle.
import { isAiFile, isPdfLike, stripRasterSourceExtension } from '@/lib/pdfUtils'

/**
 * iPhones deliver camera-roll photos as HEIC/HEIF by default. Browsers
 * report them as `image/heic` (or `image/heif`, or — on a few old/odd
 * mobile browsers — empty string with a `.heic`/`.heif` filename). Treat
 * any of those as HEIC so the conversion path can kick in. Used by every
 * type-check gate in this file so no upload entry point silently rejects
 * an iPhone photo.
 */
const isHeic = (file: File): boolean =>
  /^image\/hei[cf]$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

/**
 * Convert a HEIC/HEIF File to a JPEG File. heic2any is dynamic-imported
 * here so non-HEIC sessions (desktop, Android JPEG, etc.) never download
 * the ~600KB libheif bundle. Throws on conversion failure — callers
 * should catch and surface a per-file toast.
 */
async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import('heic2any')).default
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  const jpegBlob = Array.isArray(result) ? result[0] : result
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg') || `${file.name || 'photo'}.jpg`
  return new File([jpegBlob], newName, { type: 'image/jpeg' })
}

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
    boardWidthIn?: number
    boardHeightIn?: number
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
    boardWidthIn: options.boardWidthIn,
    boardHeightIn: options.boardHeightIn,
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
  inputFile: File,
  options: UploadOptions,
  directUpload: (file: File, opts?: DirectUploadOptions) => Promise<DirectUploadResult>
): Promise<{ success: boolean; uploadedBoard?: Board }> => {
  // HEIC is iPhone's default camera-roll format. The downstream pipeline
  // (imageCompression, canvas-based dimension reads, blob preview URLs)
  // can't decode HEIC in any non-Safari browser, so convert to JPEG first
  // and feed the rest of the function the converted File. The
  // dynamic-import inside isHeic keeps the ~600KB libheif bundle off
  // sessions that never see a HEIC.
  let file = inputFile
  if (isHeic(inputFile)) {
    try {
      file = await convertHeicToJpeg(inputFile)
    } catch (err) {
      console.error(`[Upload] HEIC conversion failed for ${inputFile.name}:`, err)
      toast.error(
        `"${inputFile.name}" — couldn't convert this photo. ` +
        `On iPhone, Settings > Camera > Formats > Most Compatible, or export as JPEG.`
      )
      return { success: false }
    }
  }

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
  // Absolute board size in inches — the source of truth for rendered size,
  // independent of the wall. Images carry no physical dims, so this falls back
  // to the aspect-ratio + 36"-larger-dimension rule.
  const { widthIn: boardWidthIn, heightIn: boardHeightIn } = boardSizeInchesFromSource({
    aspectRatio: dims.aspectRatio,
  })

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
      boardWidthIn,
      boardHeightIn,
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
      boardWidthIn,
      boardHeightIn,
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
    // Per-file toast so the failure is never invisible. The temp board
    // flashing onto the wall and disappearing is the same visual signal
    // as "nothing happened" for a user — without this toast, a failed
    // upload looked silent (the long-standing iPhone HEIC failure mode).
    const errMsg = error instanceof Error ? error.message : 'Upload failed'
    toast.error(`"${file.name}" — ${errMsg}`)
    return { success: false }
  }
}

/**
 * Upload a PDF file with multi-page support
 */
const uploadPDF = async (
  file: File,
  options: UploadOptions,
  directUpload: (file: File, opts?: DirectUploadOptions) => Promise<DirectUploadResult>
): Promise<{ success: boolean; count: number }> => {
  // Fire the progress toast BEFORE convertPDFToImages — that step runs PDF.js
  // page rasterization on the main thread and can take 15-30s for a large
  // deck. Without an immediate signal the user thinks the click did nothing.
  // P7 fired the toast after rasterization which is exactly the gap we're
  // closing in P7.1. Toast lives at bottom-center so it doesn't overlap
  // boards on the wall (top-right is the default for other toasts).
  const baseName = stripRasterSourceExtension(file.name)
  const progressToastId = `pdf-upload-${file.name}-${Date.now()}`
  toast.loading(`Preparing "${baseName}"…`, {
    id: progressToastId,
    position: 'bottom-center',
  })

  const { convertPDFToImages } = await import('@/lib/pdfToImage')
  let pages
  try {
    pages = await convertPDFToImages(file)
  } catch (err) {
    // Convert the stuck "Preparing…" loading toast into an error in place,
    // otherwise it stays sticky forever (loading has Infinity duration).
    //
    // For a .ai this is the expected failure, not an exotic one: the file was
    // saved without "Create PDF Compatible File", so there's no PDF stream to
    // read and PDF.js throws something like "Invalid PDF structure". That text
    // is true but useless to a designer — the fix is a re-export setting, so say
    // that instead. Real PDFs keep the raw parser message, which is the most
    // specific thing we know about them.
    const errMsg = err instanceof Error ? err.message : 'Failed to read PDF'
    const message = isAiFile(file)
      ? `"${baseName}" couldn't be read — re-export from Illustrator with "Create PDF Compatible File" turned on, or upload a PDF/PNG.`
      : `"${baseName}" — ${errMsg}`
    toast.error(message, {
      id: progressToastId,
      position: 'bottom-center',
    })
    throw err
  }

  // Calculate grid layout
  const cols = Math.ceil(Math.sqrt(pages.length))
  const rows = Math.ceil(pages.length / cols)

  if (pages.length === 1) {
    // Single-page PDFs upload fast and the temp-board → swap UX already
    // gives instant feedback. Drop the progress toast now that we know N=1.
    toast.dismiss(progressToastId)
  } else {
    // Now that we know the page count, transition the toast in place to the
    // proper progress message. Per-page updates happen inside the loop.
    toast.loading(`Uploading "${baseName}" — 0 of ${pages.length} pages`, {
      id: progressToastId,
      position: 'bottom-center',
    })
  }

  let successCount = 0

  // Each page is self-contained — no cross-page dependency — so process them
  // concurrently instead of awaiting each in turn. See section 23 of
  // docs/storage-audit-P1.md for the data-race analysis: setPlacedBoards3D's
  // functional-updater pattern + distinct tempBoardId per task = safe.
  // flushSync is deliberately NOT used here (it can deadlock React when
  // called from inside a parallel async chain).
  const processPage = async (pageIndex: number): Promise<void> => {
    const page = pages[pageIndex]
    const pageTitle = pages.length > 1
      ? `${baseName} - Page ${page.pageNumber}`
      : baseName

    const { widthPercent, heightPercent } = calculateBoardDimensions(
      page.aspectRatio,
      options.editingWallDimensions
    )
    // Absolute board size in inches. PDF pages carry true physical dimensions
    // (points/72), so use them directly; aspect-ratio fallback otherwise.
    const { widthIn: boardWidthIn, heightIn: boardHeightIn } = boardSizeInchesFromSource({
      aspectRatio: page.aspectRatio,
      physicalWidth: page.physicalWidth,
      physicalHeight: page.physicalHeight,
    })

    const gridPos = calculateGridPosition(pageIndex, pages.length)

    let tempBoardId: string | null = null
    let pageBlobUrl: string | null = null
    if (options.editingWall !== null && options.editingWallDimensions) {
      pageBlobUrl = URL.createObjectURL(page.imageFile)
      const blobUrl = pageBlobUrl
      tempBoardId = `temp-${Date.now()}-${pageIndex}-${Math.random().toString(36).substr(2, 9)}`

      // Pre-warm the blob texture so useBoardTexture finds it in resolvedCache on first render.
      // Without this, the JPEG decode + WebGL upload happens asynchronously after mount,
      // causing a ~1-2s skeleton. Mirrors uploadFile lines 332-347.
      await loadTexture(pageBlobUrl).catch(() => undefined)

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
        boardWidthIn,
        boardHeightIn,
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

    // Upload page. skipMainCompression: the page is already a controlled-
    // quality JPEG out of canvas.toBlob('image/jpeg', 0.85) capped at 2400px
    // (see lib/pdfToImage.ts) — running it through imageCompression again
    // would be a decode+re-encode no-op. Thumb still generates.
    try {
      const { storagePath, thumbnailPath } = await directUpload(page.imageFile, { skipMainCompression: true })

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
        boardWidthIn,
        boardHeightIn,
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

      // ++ on a shared counter is atomic in single-threaded JS; tasks may
      // finish in any order so the toast may briefly read out of sequence
      // (e.g. "3 of 3" before "2 of 3"), but the post-loop summary toast
      // reuses the same id and replaces whatever was last shown.
      successCount++
      if (pages.length > 1) {
        toast.loading(`Uploading "${baseName}" — ${successCount} of ${pages.length} pages`, {
          id: progressToastId,
          position: 'bottom-center',
        })
      }
    } catch (error) {
      console.error(`[Upload PDF] Failed to upload page ${pageIndex + 1}:`, error)
      const errMsg = error instanceof Error ? error.message : 'Upload failed'
      toast.error(`Page ${pageIndex + 1} of ${file.name}: ${errMsg}`, {
        position: 'bottom-center',
      })
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

  // allSettled (not Promise.all) so a single page rejecting can't abort the
  // others. processPage already catches its own errors, so this is belt-and-
  // suspenders against any future uncaught throw above the try block.
  await Promise.allSettled(pages.map((_, i) => processPage(i)))

  // Roll-up toast for multi-page PDFs. Reuses progressToastId so the sticky
  // loading toast is replaced in place by the success/warning summary
  // (instead of stacking a second toast). Per-page error toasts from the
  // catch above still fire as separate toasts — the user gets per-page
  // reasons AND a roll-up. Single-page PDFs are skipped (dismissed earlier).
  if (pages.length > 1) {
    const summary = `"${baseName}" — ${successCount} of ${pages.length} pages uploaded`
    if (successCount < pages.length) {
      toast.warning(summary, { id: progressToastId, position: 'bottom-center' })
    } else {
      toast.success(summary, { id: progressToastId, position: 'bottom-center' })
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
    // Mix extensions and MIME types so iOS, Android, and desktop pickers
    // all surface HEIC/HEIF photos from the library. iOS reports HEIC as
    // `image/heic`; older Android sometimes reports an empty type and the
    // extension is what's left to match on.
    // .ai is listed by extension only — there is no MIME for Illustrator we can
    // rely on across platforms (see isAiFile in lib/pdfUtils.ts).
    input.accept = '.jpg,.jpeg,.png,.pdf,.ai,.heic,.heif,image/heic,image/heif,image/jpeg,image/png'
    input.multiple = true
    
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return
      
      // Empty-string covered via isHeic — some browsers omit the type for
      // HEIC and only the extension is left to match on. .ai is admitted by
      // extension for the same reason (isAiFile), since its MIME is whatever the
      // uploader's OS happens to say.
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/heic', 'image/heif', '']
      let successCount = 0
      let failCount = 0
      const oversized: string[] = []

      for (const file of files) {
        if (!validTypes.includes(file.type) && !isHeic(file) && !isAiFile(file)) {
          // Surface — silent failCount++ on unsupported file types is the
          // mode that made iPhone HEICs look like "nothing happened" to
          // users on mobile.
          toast.error(`"${file.name}" — unsupported format (${file.type || 'unknown'}).`)
          failCount++
          continue
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          const mb = (file.size / (1024 * 1024)).toFixed(1)
          oversized.push(`${file.name} (${mb} MB)`)
          failCount++
          continue
        }

        try {
          // isPdfLike, not a MIME equality check: this must win over the image
          // path for a .ai whose MIME is empty, which the '' entry in validTypes
          // above would otherwise wave through as an image.
          if (isPdfLike(file)) {
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
        toast.error(`These files are too large (max 75 MB):\n${oversized.join('\n')}`)
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
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', '']
    if (!validImageTypes.includes(file.type) && !isHeic(file)) return false
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      toast.error(`${file.name} is too large (${mb} MB). Maximum size is 75 MB.`)
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

  /** Upload multiple files (e.g. from drag-and-drop). Supports images + PDFs + .ai. */
  const uploadFilesDirect = async (files: File[]): Promise<void> => {
    // Mirrors the picker gate above: MIME list, plus extension-based admission
    // for HEIC and .ai whose reported types can't be trusted.
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/heic', 'image/heif', '']
    let successCount = 0
    let failCount = 0
    const oversized: string[] = []

    for (const file of files) {
      if (!validTypes.includes(file.type) && !isHeic(file) && !isAiFile(file)) {
        toast.error(`"${file.name}" — unsupported format (${file.type || 'unknown'}).`)
        failCount++
        continue
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(1)
        oversized.push(`${file.name} (${mb} MB)`)
        failCount++
        continue
      }
      try {
        // See the picker branch: isPdfLike must beat the '' image fallthrough.
        if (isPdfLike(file)) {
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
      toast.error(`Files too large (max 75 MB):\n${oversized.join('\n')}`)
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

