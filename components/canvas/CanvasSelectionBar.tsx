'use client'

import { ROOM, SANS_STACK } from '@/lib/room/palette'
import type { AlignMode, DistributeMode } from '@/lib/canvas/arrange'

/**
 * The actions that only make sense with something selected, floating above it.
 *
 * Separate from the tool rail deliberately. The rail is about what the NEXT
 * gesture will do and is always there; this is about the objects in hand and
 * appears only when there are some. Putting alignment on the permanent rail
 * would mean six buttons that are dead most of the time.
 *
 * Positioned in SCREEN space by the caller, which already computes the
 * selection's screen bounds for the outline. Keeping it out of the transformed
 * layer is what stops it shrinking as the canvas zooms out.
 */
export default function CanvasSelectionBar({
  x,
  y,
  below,
  count,
  onAlign,
  onDistribute,
  onDuplicate,
  onRestack,
  onDelete,
}: {
  /** Screen position of the selection's top-centre — or bottom, when `below`. */
  x: number
  y: number
  /** Hang under the selection instead of over it, when there is no room above. */
  below?: boolean
  count: number
  onAlign: (mode: AlignMode) => void
  onDistribute: (mode: DistributeMode) => void
  onDuplicate: () => void
  onRestack: (direction: 'front' | 'back') => void
  onDelete: () => void
}) {
  // Alignment needs two objects and distribution needs three — with fewer,
  // they are no-ops. Hidden rather than disabled: a row of permanently greyed
  // buttons above every single-node selection is noise, and this bar is
  // already contextual by nature.
  const multi = count >= 2
  const spreadable = count >= 3

  return (
    <div
      // The bar sits over the canvas; a press here must not start a gesture or
      // clear the very selection it is acting on.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        // Centred on the selection and lifted clear of its outline and handles.
        transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        marginTop: below ? 14 : -14,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        padding: 3,
        borderRadius: 10,
        background: ROOM.wall,
        border: `1px solid ${ROOM.hairline}`,
        boxShadow: '0 4px 14px rgba(22,24,29,0.14)',
        fontFamily: SANS_STACK,
        // Above the node layer and the overlay, below the tool rail.
        zIndex: 2,
        whiteSpace: 'nowrap',
      }}
    >
      {multi && (
        <>
          <Action label="Align left" glyph="⇤" onClick={() => onAlign('left')} />
          <Action label="Align centre" glyph="↔" onClick={() => onAlign('center-x')} />
          <Action label="Align right" glyph="⇥" onClick={() => onAlign('right')} />
          <Divider />
          <Action label="Align top" glyph="⤒" onClick={() => onAlign('top')} />
          <Action label="Align middle" glyph="↕" onClick={() => onAlign('center-y')} />
          <Action label="Align bottom" glyph="⤓" onClick={() => onAlign('bottom')} />
          <Divider />
        </>
      )}

      {spreadable && (
        <>
          <Action
            label="Space evenly across"
            glyph="⇹"
            onClick={() => onDistribute('horizontal')}
          />
          <Action label="Space evenly down" glyph="⇳" onClick={() => onDistribute('vertical')} />
          <Divider />
        </>
      )}

      <Action label="Bring to front ( ] )" glyph="⤴" onClick={() => onRestack('front')} />
      <Action label="Send to back ( [ )" glyph="⤵" onClick={() => onRestack('back')} />
      <Divider />
      <Action label="Duplicate (⌘D)" glyph="⧉" onClick={onDuplicate} />
      <Action label="Delete" glyph="🗑" onClick={onDelete} danger />
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: ROOM.hairline, margin: '0 3px' }} />
}

function Action({
  label,
  glyph,
  onClick,
  danger,
}: {
  label: string
  glyph: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 28,
        height: 26,
        display: 'grid',
        placeItems: 'center',
        border: 'none',
        borderRadius: 7,
        background: 'transparent',
        color: danger ? ROOM.redline : ROOM.ink2,
        fontSize: 13,
        lineHeight: 1,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {glyph}
    </button>
  )
}
