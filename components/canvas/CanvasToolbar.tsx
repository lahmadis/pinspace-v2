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

export type CanvasTool = 'select' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'ink'

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
}: {
  tool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  color: string
  onColorChange: (color: string) => void
  disabled?: boolean
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

      <div style={{ height: 1, background: ROOM.hairline, margin: '4px 6px' }} />

      {/* Colour applies to whatever gets drawn next, and to the current
          selection if there is one — same as every canvas tool people have
          used before this one. */}
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
    </div>
  )
}
