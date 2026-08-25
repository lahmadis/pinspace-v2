'use client'

import { ROOM } from '@/lib/room/palette'

/**
 * The tool rail.
 *
 * Left edge, vertical: the top of the viewport already carries the breadcrumb,
 * presence and toolbar band, and the bottom carries the view switcher, so a
 * horizontal bar would be the third stacked strip competing for the same edges.
 * The left side is empty and matches what people expect from a canvas app.
 */

export type CanvasTool = 'select' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink'

interface ToolDef {
  id: CanvasTool
  label: string
  shortcut: string
  /** Single-glyph mark. Kept as text rather than icon files so the rail has no
   *  asset dependency and scales with the user's font settings. */
  glyph: string
}

export const CANVAS_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V', glyph: '⌖' },
  { id: 'sticky', label: 'Sticky note', shortcut: 'S', glyph: '▧' },
  { id: 'text', label: 'Text', shortcut: 'T', glyph: 'T' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', glyph: '▭' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', glyph: '◯' },
  { id: 'line', label: 'Line', shortcut: 'L', glyph: '╱' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', glyph: '↗' },
  { id: 'ink', label: 'Pen', shortcut: 'P', glyph: '✎' },
]

/** Ink and sticky colours. Shared with the canvas so a stroke and a note drawn
 *  in the same slot match. */
export const INK_COLORS = [ROOM.ink, ROOM.accent, ROOM.redline, '#1F7A5A']

export default function CanvasToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  disabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPickImage,
}: {
  tool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  color: string
  onColorChange: (color: string) => void
  disabled?: boolean
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  /** Opens the file picker. Not a CanvasTool — it arms nothing, it acts now. */
  onPickImage?: () => void
}) {
  if (disabled) return null

  return (
    <div
      // Pointer events must not reach the canvas underneath, or picking a tool
      // would also start a gesture at that point.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 4,
        borderRadius: 12,
        background: ROOM.wall,
        border: `1px solid ${ROOM.hairline}`,
        boxShadow: '0 2px 10px rgba(22,24,29,0.10)',
        zIndex: 2,
      }}
    >
      {CANVAS_TOOLS.map((t) => {
        const active = t.id === tool
        return (
          <button
            key={t.id}
            onClick={() => onToolChange(t.id)}
            title={`${t.label} (${t.shortcut})`}
            aria-pressed={active}
            aria-label={t.label}
            style={{
              width: 36,
              height: 36,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              borderRadius: 8,
              background: active ? ROOM.accent : 'transparent',
              color: active ? ROOM.wall : ROOM.ink2,
              fontSize: 16,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            {t.glyph}
          </button>
        )
      })}

      {/* Image is an ACTION, not a tool: it opens a picker rather than arming
          the pointer, so it never becomes the active tool and has no shortcut
          competing with the letter keys. Dragging a file onto the canvas does
          the same thing and is the faster route — this is for people who don't
          know that yet. */}
      <button
        onClick={onPickImage}
        title="Add an image (or drag one onto the canvas)"
        aria-label="Add an image"
        style={{
          width: 36,
          height: 36,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          borderRadius: 8,
          background: 'transparent',
          color: ROOM.ink2,
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ▣
      </button>

      <div style={{ height: 1, background: ROOM.hairline, margin: '4px 6px' }} />

      {/* Colour for whatever gets drawn next AND for whatever is selected now.
          The caller applies it to the selection; picking a colour with objects
          selected means "make these that colour" everywhere else, and doing
          only half of that is the more surprising behaviour. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, padding: '2px 4px 4px' }}>
        {INK_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            title="Colour"
            aria-label={`Colour ${c}`}
            aria-pressed={c === color}
            style={{
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: c,
              border: c === color ? `2px solid ${ROOM.ink}` : `1px solid ${ROOM.hairline}`,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>

      <div style={{ height: 1, background: ROOM.hairline, margin: '2px 6px 4px' }} />

      {/* Undo and redo. Duplicated from the keyboard rather than left to it:
          the shortcuts only fire while the canvas surface itself holds focus,
          and this is also the only thing on screen that says whether there is
          anything left to undo. */}
      <div style={{ display: 'flex', gap: 2 }}>
        <HistoryButton
          glyph="↺"
          label="Undo"
          shortcut="⌘Z / Ctrl+Z"
          enabled={!!canUndo}
          onClick={onUndo}
        />
        <HistoryButton
          glyph="↻"
          label="Redo"
          shortcut="⇧⌘Z / Ctrl+Y"
          enabled={!!canRedo}
          onClick={onRedo}
        />
      </div>
    </div>
  )
}

function HistoryButton({
  glyph,
  label,
  shortcut,
  enabled,
  onClick,
}: {
  glyph: string
  label: string
  shortcut: string
  enabled: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      // Disabled rather than hidden, so the pair keeps the rail the same width
      // whatever the stacks hold.
      disabled={!enabled}
      title={`${label} (${shortcut})`}
      aria-label={label}
      style={{
        width: 36,
        height: 30,
        display: 'grid',
        placeItems: 'center',
        border: 'none',
        borderRadius: 8,
        background: 'transparent',
        color: enabled ? ROOM.ink2 : ROOM.hairline,
        fontSize: 15,
        lineHeight: 1,
        cursor: enabled ? 'pointer' : 'default',
      }}
    >
      {glyph}
    </button>
  )
}
