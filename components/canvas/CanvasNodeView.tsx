'use client'

import { useEffect, useRef, useState } from 'react'
import { ROOM, SANS_STACK } from '@/lib/room/palette'
import type { CanvasNode } from '@/lib/canvas/types'

/**
 * One node, rendered in CANVAS units inside the transformed layer — so nothing
 * here knows about zoom.
 *
 * Rotation is applied about the centre to match lib/canvas/geometry.ts. Any
 * other transform-origin makes rendering and hit-testing disagree the moment a
 * node is rotated, which reads as "the outline is in the wrong place".
 */

export interface InkProps {
  /** Points in the stroke's ORIGINAL local pixel space, origin at its bbox. */
  points?: number[][]
  /** The bbox those points were captured in. The SVG viewBox, so resizing the
   *  node scales the stroke instead of cropping it. */
  bw?: number
  bh?: number
  color?: string
  size?: number
}

export interface NodeProps extends InkProps {
  text?: string
  fill?: string
  stroke?: string
  shape?: 'rect' | 'ellipse'
}

export const STICKY_COLORS = ['#FFE8A3', '#FFD5C2', '#D6E4FF', '#D9F2E3', '#EADCF8']

/** Smallest stroke bbox we will store, so a perfectly straight line doesn't
 *  produce a zero-height viewBox and a division by zero downstream. */
export const MIN_INK_EXTENT = 1

export function pathFromPoints(points: number[][]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    // A dot. Zero-length path with a round cap renders nothing in some engines,
    // so give it a hair of length.
    const [x, y] = points[0]
    return `M ${x} ${y} L ${x + 0.01} ${y}`
  }
  return points.reduce(
    (d, [x, y], i) => (i === 0 ? `M ${x} ${y}` : `${d} L ${x} ${y}`),
    ''
  )
}

export default function CanvasNodeView({
  node,
  isEditing,
  onCommitText,
  onCancelEdit,
}: {
  node: CanvasNode
  isEditing?: boolean
  onCommitText?: (text: string) => void
  onCancelEdit?: () => void
}) {
  const props = node.props as NodeProps

  const frame: React.CSSProperties = {
    position: 'absolute',
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
    transform: `rotate(${node.rotation}rad)`,
    transformOrigin: 'center center',
  }

  if (node.type === 'ink') {
    const bw = Math.max(MIN_INK_EXTENT, props.bw ?? node.w)
    const bh = Math.max(MIN_INK_EXTENT, props.bh ?? node.h)
    return (
      <div style={{ ...frame, pointerEvents: 'none' }}>
        <svg
          width={node.w}
          height={node.h}
          viewBox={`0 0 ${bw} ${bh}`}
          // The stroke must stretch with the box rather than stay square, so a
          // non-uniform resize squashes it the way a drawn line would squash.
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path
            d={pathFromPoints(props.points ?? [])}
            fill="none"
            stroke={props.color || ROOM.ink}
            strokeWidth={props.size ?? 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  if (node.type === 'shape') {
    return (
      <div
        style={{
          ...frame,
          background: props.fill || 'transparent',
          border: `2px solid ${props.stroke || ROOM.ink}`,
          borderRadius: props.shape === 'ellipse' ? '50%' : 4,
        }}
      />
    )
  }

  const isSticky = node.type === 'sticky'
  return (
    <div
      style={{
        ...frame,
        background: isSticky ? props.fill || STICKY_COLORS[0] : 'transparent',
        border: isSticky ? 'none' : undefined,
        borderRadius: isSticky ? 2 : 0,
        boxShadow: isSticky ? '0 1px 3px rgba(22,24,29,0.12)' : 'none',
        padding: isSticky ? 12 : 4,
        overflow: 'hidden',
        color: props.color || ROOM.ink,
        fontFamily: SANS_STACK,
        fontSize: isSticky ? 15 : 20,
        lineHeight: 1.35,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {isEditing ? (
        <TextEditor
          initial={props.text ?? ''}
          onCommit={onCommitText}
          onCancel={onCancelEdit}
          sticky={isSticky}
        />
      ) : (
        props.text
      )}
    </div>
  )
}

/**
 * Inline editor for sticky and text nodes.
 *
 * A textarea rather than contentEditable: this only ever holds plain text, and
 * contentEditable would let pasted HTML in, which then has to be sanitised
 * before it reaches props and again before it renders.
 *
 * It lives INSIDE the transformed layer, so it inherits the canvas zoom and the
 * node's rotation for free — the caret and the committed text land in the same
 * place at any zoom, which is the thing that goes wrong when an editor is
 * hoisted into screen space.
 */
function TextEditor({
  initial,
  onCommit,
  onCancel,
  sticky,
}: {
  initial: string
  onCommit?: (text: string) => void
  onCancel?: () => void
  sticky: boolean
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  /**
   * Whether this editor has already finished.
   *
   * Enter and Escape both end the edit and then move focus, and moving focus
   * fires focusout on a textarea that is still mounted — React turns that into
   * onBlur, which would commit again. Escape was the bad case: it would save
   * the very text the user just discarded. A single latch makes the first
   * outcome the only outcome, whichever route it came from.
   */
  const doneRef = useRef(false)

  const finish = (commit: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) onCommit?.(value)
    else onCancel?.()
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    // Caret to the end, so editing existing text continues it rather than
    // replacing it on the next keystroke.
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      // Pointer events stop here: a drag inside the editor is text selection,
      // not a node move.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Every key stops here while typing, or the canvas would read Delete as
        // "remove the selected node" and V as "switch to the select tool".
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
          return
        }
        // Enter commits; Shift+Enter is a newline. A sticky is a short note, and
        // making the common case need a modifier gets it wrong more often.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          finish(true)
        }
      }}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        resize: 'none',
        // The canvas container sets userSelect:'none' to stop drags selecting
        // page text; it inherits in here and would kill drag-select inside a
        // note on Safari and iOS.
        userSelect: 'text',
        WebkitUserSelect: 'text',
        padding: 0,
        margin: 0,
        color: 'inherit',
        font: 'inherit',
        lineHeight: 'inherit',
        overflow: 'hidden',
      }}
      placeholder={sticky ? 'Type a note' : 'Type'}
    />
  )
}
