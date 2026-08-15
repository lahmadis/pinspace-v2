import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { snapshotToPositionUpdates } from '@/components/3d/useBoardState'

describe('undo snapshot persistence', () => {
  it('preserves each board wall and side while restoring snapshot coordinates', () => {
    const updates = snapshotToPositionUpdates(
      [['board-1', { x: -0.2, y: 0.15, width: 0.4, height: 0.3 }]],
      [{
        id: 'board-1',
        position: { wallIndex: 3, x: 50, y: 50, width: 30, height: 30, side: 'back' },
      }],
    )

    expect(updates).toEqual([{
      boardId: 'board-1',
      wallIndex: 3,
      side: 'back',
      x: -0.2,
      y: 0.15,
      width: 0.4,
      height: 0.3,
    }])
  })

  it('drops snapshot entries whose board no longer exists', () => {
    expect(snapshotToPositionUpdates(
      [['deleted-board', { x: 0, y: 0, width: 0.3, height: 0.3 }]],
      [],
    )).toEqual([])
  })

  it('routes restored snapshots through queued bulk persistence without recording a second undo entry', () => {
    const source = readFileSync('components/3d/useBoardState.ts', 'utf8')
    expect(source).toContain(
      'await updateBoardPositionsBulk(updates, { recordUndo: false })',
    )
    expect(source).toContain("toast.error('Could not save every restored board position. Try undo or redo again.')")
  })
})
