import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

const ownedPresentationFiles = [
  'app/studio/[id]/page.tsx',
  'app/studio/[id]/view/page.tsx',
  'app/studio/new/page.tsx',
  'components/3d/EditModeOverlay.tsx',
  'components/3d/FloorEditorOverlay.tsx',
  'components/3d/PresenceBar.tsx',
  'components/PinModeHeader.tsx',
  'components/CritModeHeader.tsx',
  'components/CommentPanel.tsx',
  'components/RightCommentPanel.tsx',
  'components/SideCommentPanel.tsx',
  'components/QuickNotePanel.tsx',
  'components/ShareModal.tsx',
]

describe('studio presentation contracts', () => {
  it('uses StudioShell and shared status states for editor and viewer routes', () => {
    for (const path of ['app/studio/[id]/page.tsx', 'app/studio/[id]/view/page.tsx']) {
      const source = read(path)
      expect(source, path).toContain('StudioShell')
      expect(source, path).toContain('StatusState')
    }
  })

  it('provides explicit empty-room guidance in editor and viewer routes', () => {
    expect(read('app/studio/[id]/page.tsx')).toContain('No boards in this room yet')
    expect(read('app/studio/[id]/view/page.tsx')).toContain('This room has no boards yet')
  })

  it('uses only semantic presentation colors in owned studio UI', () => {
    const legacy = /(?:bg|text|border|ring|from|via|to|shadow)-(?:gray|slate|indigo|purple|blue)-\d+(?:\/\d+)?|#(?:4444ff|3333ee|3333dd|B3B3FF|D8DEFF)|rgba\(102,\s*102,\s*255/gi
    for (const path of ownedPresentationFiles) {
      expect(read(path).match(legacy) ?? [], path).toEqual([])
    }
  })

  it('keeps overlay controls clear of safe areas and honors reduced motion', () => {
    for (const path of ownedPresentationFiles) {
      const source = read(path)
      if (!source.includes('fixed')) continue
      expect(source, path).toMatch(/safe-area|env\(safe-area|motion-reduce/)
    }
  })

  it('raises shared overlay close controls to the studio 44px touch-target minimum', () => {
    for (const path of [
      'app/studio/[id]/view/page.tsx',
      'components/3d/StudioRoom.tsx',
      'components/3d/FloorEditorOverlay.tsx',
      'components/CommentPanel.tsx',
      'components/RightCommentPanel.tsx',
      'components/SideCommentPanel.tsx',
      'components/ShareModal.tsx',
    ]) {
      expect(read(path), path).toContain('[&>button.absolute]:h-11')
    }
  })

  it('keeps floor-plan wall controls keyboard and touch operable', () => {
    const source = read('components/3d/FloorEditorOverlay.tsx')
    expect(source).toContain('handleWallKeyDown')
    expect(source).toContain('Use arrow keys to move')
    expect(source).toContain('r={22}')
    expect(source).toContain('width: 44, height: 44')
  })

  it('preserves a definite height chain for model viewers inside shared dialogs', () => {
    for (const path of ['app/studio/[id]/view/page.tsx', 'components/3d/StudioRoom.tsx']) {
      const source = read(path)
      expect(source, path).toContain('[&>div.mt-5]:flex-1')
      expect(source, path).toContain('className="h-full min-h-0 overflow-hidden')
    }
  })

  it('shares comment loading, posting, identity, and presentation instead of cloning panels', () => {
    const readOnlyPanel = read('components/CommentPanel.tsx')
    expect(readOnlyPanel).toContain('CommentList')
    expect(readOnlyPanel).not.toContain('function formatTimestamp')

    for (const path of ['components/RightCommentPanel.tsx', 'components/SideCommentPanel.tsx']) {
      const source = read(path)
      expect(source, path).toContain('useBoardComments')
      expect(source, path).toContain('useCommentIdentity')
      expect(source, path).toContain('CommentList')
      expect(source, path).toContain('CommentComposer')
      expect(source, path).not.toContain('function formatTimestamp')
      expect(source, path).not.toContain('<textarea')
    }
  })

  it('does not introduce unsafe HTML or change studio API endpoints', () => {
    const combined = ownedPresentationFiles.map(read).join('\n')
    expect(combined).not.toContain('dangerouslySetInnerHTML')
    expect(combined).not.toContain('document.write')
    expect(combined).toContain('/api/workspaces')
    expect(combined).toContain('/api/boards')
    expect(combined).toContain('/api/rooms/${studioId}/share')
  })
})
