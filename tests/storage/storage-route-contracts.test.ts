import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('storage route contracts', () => {
  it('duplicates owned storage objects instead of aliasing source URLs', () => {
    const source = readFileSync('app/api/boards/duplicate/route.ts', 'utf8')
    expect(source).toContain('buildBoardStorageCopyPlan')
    expect(source).toContain('.copy(copy.sourcePath, copy.destinationPath)')
    expect(source).toContain('.remove(copiedPaths)')
    expect(source).not.toContain('thumbnail_url: source.thumbnail_url')
    expect(source).not.toContain('full_image_url: source.full_image_url')
  })

  it('room deletion inventories objects before cascade and rechecks references after it', () => {
    const source = readFileSync('app/api/rooms/[id]/route.ts', 'utf8')
    expect(source).toContain('collectBoardStoragePaths')
    expect(source).toContain('unreferencedBoardStoragePaths')
    expect(source).toContain(".storage.from('board-images').remove(unreferencedPaths)")
  })

  it('workspace deletion cleans board media, wall configs, and unreferenced models', () => {
    const source = readFileSync('app/api/workspaces/[id]/route.ts', 'utf8')
    expect(source).toContain('workspaceBoardPaths')
    expect(source).toContain('workspaceConfigPaths')
    expect(source).toContain('workspaceModelPaths')
    expect(source).toContain('unreferencedWorkspaceObjects')
  })

  it('metadata creation enforces verified-user path ownership and rejects aliases', () => {
    const source = readFileSync('app/api/boards/route.ts', 'utf8')
    expect(source).toContain('isOwnedBoardStoragePath(storagePath, userId)')
    expect(source).toContain('Storage object is already attached to a board')
  })

  it('orphan cleanup protects recent uploads and rechecks references before apply', () => {
    const source = readFileSync('scripts/cleanup-orphan-storage.ts', 'utf8')
    expect(source).toContain('DEFAULT_MIN_AGE_HOURS = 24')
    expect(source).toContain('created_at')
    expect(source).toContain('Skipping recent or timestamp-unknown object')
    expect(source).toContain('Re-checking references before deletion batch')
  })

  it('exports only verified board-images objects through the Storage API', () => {
    const source = readFileSync('app/api/workspaces/[id]/export/route.ts', 'utf8')
    expect(source).toContain('trustedBoardStoragePath')
    expect(source).toContain(".storage.from('board-images').download(storagePath)")
    expect(source).toContain('isOwnedBoardStoragePath(storagePath, board.owner_id)')
    expect(source).not.toContain('fetch(imgUrl)')
  })
})
