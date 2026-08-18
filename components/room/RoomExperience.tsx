'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { Board, FloorTable } from '@/types'
import { ROOM } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'
import { buildRoomShell, type RoomBay, type RoomShellConfig } from '@/lib/room/roomShell'
import { useRoomNavigation } from './useRoomNavigation'
import RoomStage from './RoomStage'
import RoomCompass from './RoomCompass'

/**
 * The fixed-camera room, assembled: navigation + the shell + the compass + the
 * turn controls, all driven off one `buildRoomShell` so they can never disagree
 * about the room's geometry. This is the one piece every room-viewing surface
 * (editor, `/view`, `/crit`, `/share`, the two `/demo` pages) mounts — see
 * docs/audit-3d-room.md finding #1, which this also resolves by construction.
 *
 * Floor tables are deliberately NOT drawn inside the 3D shell. Their stored
 * (x, z) is a position in the OLD open-plan wall layout
 * (lib/wallLayout.ts's getWallTransform), which this closed ring does not
 * reuse — see the comment atop lib/room/roomShell.ts. Re-deriving a meaningful
 * position for a table inside a geometry it was never placed in is a guess, so
 * instead every table with a model is listed in a small fixed tray: still one
 * click to the same on-demand `<ModelViewer>` overlay, no invented coordinates.
 */

export interface RoomExperienceProps {
  wallConfig: RoomShellConfig
  boards: Board[]
  tables?: FloorTable[]
  wallColor?: 'grey' | 'white'
  students?: RoomStudent[]
  selectedStudentId?: string | null
  onBoardOpen?: (board: Board) => void
  onTableModelClick?: (modelUrl: string) => void
  /** Present only when this viewer may edit walls; also gates the tray/chrome affordance. */
  onEditWall?: (wallIndex: number, side: 'front' | 'back') => void
  suppressCallouts?: boolean
  /**
   * Wall indices someone else is currently editing — same Set StudioRoom
   * already threads into WallSystem's "faint highlight" for the old 3D view
   * (see StudioRoomProps.othersEditingWalls). No side info, so both the front
   * and back bay of a flagged wall are marked; RoomStage/RoomCompass want bay
   * indices, not wall indices, so that translation happens here.
   */
  othersEditingWalls?: Set<number>
  /** Roster / Unfolded / Plan "face this wall" request — bump requestNonce to re-fire on the same wall. */
  requestWallIndex?: number | null
  requestSide?: 'front' | 'back'
  requestNonce?: number
}

export default function RoomExperience({
  wallConfig,
  boards,
  tables = [],
  wallColor = 'grey',
  students = [],
  selectedStudentId = null,
  onBoardOpen,
  onTableModelClick,
  onEditWall,
  suppressCallouts = false,
  othersEditingWalls,
  requestWallIndex,
  requestSide = 'front',
  requestNonce,
}: RoomExperienceProps) {
  const shell = useMemo(() => buildRoomShell(wallConfig, boards), [wallConfig, boards])
  const nav = useRoomNavigation(shell.bays.length)

  const occupiedBays = useMemo(() => {
    if (!othersEditingWalls || othersEditingWalls.size === 0) return undefined
    const bays = new Set<number>()
    shell.bays.forEach((bay, i) => {
      if (othersEditingWalls.has(bay.wallIndex)) bays.add(i)
    })
    return bays
  }, [othersEditingWalls, shell.bays])

  const lastRequestNonce = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (requestNonce === undefined || requestNonce === lastRequestNonce.current) return
    lastRequestNonce.current = requestNonce
    if (requestWallIndex == null) return
    const bayIdx = shell.bays.findIndex((b) => b.wallIndex === requestWallIndex && b.side === requestSide)
    if (bayIdx >= 0) nav.goToBay(bayIdx)
    // nav.goToBay is stable (useCallback) but not in deps to avoid re-running on its identity churn alone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNonce, requestWallIndex, requestSide, shell.bays])

  const handleEditFacingWall = (bay: RoomBay) => {
    if (bay.blank || !onEditWall) return
    onEditWall(bay.wallIndex, bay.side)
  }

  const modelTables = useMemo(() => tables.filter((t) => !!t.modelUrl), [tables])

  return (
    <div className="absolute inset-0" style={{ background: ROOM.background }}>
      <RoomStage
        shell={shell}
        boards={boards}
        facing={nav.facing}
        wallColor={wallColor}
        students={students}
        selectedStudentId={selectedStudentId}
        onBoardOpen={onBoardOpen}
        suppressCallouts={suppressCallouts}
        animate={nav.animate}
        occupiedBays={occupiedBays}
        onEditWall={onEditWall ? handleEditFacingWall : undefined}
      />

      <RoomCompass
        shell={shell}
        facing={nav.facing}
        onSelectBay={nav.goToBay}
        occupiedBays={occupiedBays}
        animate={nav.animate}
      />

      {shell.bays.length > 1 && (
        <>
          {(['left', 'right'] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => nav.step(side === 'left' ? -1 : 1)}
              aria-label={side === 'left' ? 'Previous wall' : 'Next wall'}
              className={`fixed top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-4' : 'right-4'} z-40 w-11 h-16 rounded-xl shadow-lg flex items-center justify-center transition-opacity hover:opacity-70`}
              style={{ background: ROOM.wall, color: ROOM.ink2, border: `1px solid ${ROOM.hairline}` }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={side === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
              </svg>
            </button>
          ))}
        </>
      )}

      {modelTables.length > 0 && onTableModelClick && (
        <div
          className="fixed bottom-28 left-4 z-30 flex items-center gap-1.5 rounded-2xl shadow-xl px-2 py-2"
          style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
          aria-label="3D models on the floor"
        >
          {modelTables.map((table, i) => (
            <button
              key={table.id}
              type="button"
              onClick={() => onTableModelClick(table.modelUrl!)}
              title="Open 3D model"
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
              style={{ background: ROOM.chip, border: `1px solid ${ROOM.hairline}` }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ROOM.ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
              </svg>
              <span className="sr-only">{`Model ${i + 1}`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
