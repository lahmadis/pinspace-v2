export interface BoardObjectRow {
  thumbnail_url?: string | null
  full_image_url?: string | null
}

export interface BoardStorageCopy {
  sourcePath: string
  destinationPath: string
}

export interface BoardStorageCopyPlan {
  copies: BoardStorageCopy[]
  thumbnailDestinationPath: string | null
  fullDestinationPath: string | null
}

const BUCKET_MARKER = '/board-images/'

export function extractBoardStoragePath(
  url: string | null | undefined
): string | null {
  if (!url) return null
  const index = url.indexOf(BUCKET_MARKER)
  if (index === -1) return null
  const raw = url.slice(index + BUCKET_MARKER.length).split('?')[0]
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function isOwnedBoardStoragePath(path: string, userId: string): boolean {
  if (!path || !userId || path.startsWith('/') || path.includes('\\')) return false
  const segments = path.split('/')
  if (segments[0] !== userId || segments.length < 2) return false
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function extensionFor(path: string): string {
  const leaf = path.split('/').pop() ?? ''
  const dot = leaf.lastIndexOf('.')
  if (dot <= 0) return ''
  const extension = leaf.slice(dot)
  return /^\.[a-zA-Z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : ''
}

export function buildBoardStorageCopyPlan(
  thumbnailUrl: string | null | undefined,
  fullImageUrl: string | null | undefined,
  destinationUserId: string,
  newBoardId: string
): BoardStorageCopyPlan {
  const sourcePaths = [
    extractBoardStoragePath(thumbnailUrl),
    extractBoardStoragePath(fullImageUrl),
  ]
  const destinationBySource = new Map<string, string>()
  const copies: BoardStorageCopy[] = []

  for (const sourcePath of sourcePaths) {
    if (!sourcePath || destinationBySource.has(sourcePath)) continue
    const destinationPath = [
      safeSegment(destinationUserId),
      'duplicates',
      `${safeSegment(newBoardId)}-${copies.length + 1}${extensionFor(sourcePath)}`,
    ].join('/')
    destinationBySource.set(sourcePath, destinationPath)
    copies.push({ sourcePath, destinationPath })
  }

  return {
    copies,
    thumbnailDestinationPath: sourcePaths[0]
      ? destinationBySource.get(sourcePaths[0]) ?? null
      : null,
    fullDestinationPath: sourcePaths[1]
      ? destinationBySource.get(sourcePaths[1]) ?? null
      : null,
  }
}

export function collectBoardStoragePaths(rows: BoardObjectRow[]): Set<string> {
  const paths = new Set<string>()
  for (const row of rows) {
    for (const url of [row.thumbnail_url, row.full_image_url]) {
      const path = extractBoardStoragePath(url)
      if (path) paths.add(path)
    }
  }
  return paths
}

export function collectWallConfigModelPaths(configs: unknown[]): Set<string> {
  const paths = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue
    const tables = (config as { tables?: unknown }).tables
    if (!Array.isArray(tables)) continue
    for (const table of tables) {
      if (!table || typeof table !== 'object' || Array.isArray(table)) continue
      const modelUrl = (table as { modelUrl?: unknown }).modelUrl
      if (typeof modelUrl !== 'string' || modelUrl.startsWith('blob:') || modelUrl.startsWith('data:')) continue
      const path = extractBoardStoragePath(modelUrl)
      if (path) paths.add(path)
    }
  }
  return paths
}

export function unreferencedBoardStoragePaths(
  candidates: Iterable<string>,
  remainingRows: BoardObjectRow[]
): string[] {
  const referenced = collectBoardStoragePaths(remainingRows)
  return Array.from(new Set(candidates)).filter((path) => !referenced.has(path))
}
