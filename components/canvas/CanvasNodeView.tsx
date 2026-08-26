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
  shape?: 'rect' | 'ellipse' | 'line' | 'arrow'
  /**
   * Which diagonal a line runs along.
   *
   * A line is stored as a BOX, and a box cannot say whether the stroke goes
   * top-left→bottom-right or bottom-left→top-right. Without this, dragging a
   * line upward and one downward produced identical rectangles and both drew
   * the same way. 'nwse' is the default because it matches a drag down-right,
   * which is how most lines get made.
   */
  diagonal?: 'nwse' | 'swne'
  /**
   * Which way a line runs: along its box's diagonal, or straight across it.
   *
   * A dead-horizontal drag produces a box with ZERO height. That box cannot be
   * clicked (pointInNode needs the pointer exactly on the line) and does not
   * even render, because an outer <svg> with a zero dimension is skipped by the
   * spec. So an axis-aligned line is stored with a real thickness and drawn
   * through the MIDDLE of that box rather than corner to corner — which is also
   * what keeps it straight after a resize.
   */
  axis?: 'diagonal' | 'horizontal' | 'vertical'
  /** Image nodes — see lib/canvas/imageNode.ts for the full shape. */
  url?: string
  thumbUrl?: string
  name?: string
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

  if (node.type === 'image') {
    return <ImageNode props={props} frame={frame} />
  }

  if (node.type === 'shape') {
    // Lines and arrows are shape VARIANTS rather than their own node type: the
    // type list is fixed by migration 036's CHECK, and a line is a box with a
    // stroke drawn corner to corner. Same geometry, same handles, same resize —
    // only the paint differs, which is exactly what props are for.
    if (props.shape === 'line' || props.shape === 'arrow') {
      return <LineNode node={node} props={props} frame={frame} />
    }
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
        // The canvas also claims some Cmd/Ctrl combos the BROWSER acts on.
        // stopPropagation keeps them from the canvas but not from the browser,
        // so Cmd+D inside a sticky opened the bookmark dialog. These are the
        // ones the canvas owns; everything else (Cmd+C, Cmd+V, Cmd+A) is left
        // native on purpose, because that is what you want while typing.
        if ((e.metaKey || e.ctrlKey) && ['d', ']', '['].includes(e.key.toLowerCase())) {
          e.preventDefault()
        }
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

/**
 * An uploaded image on the canvas.
 *
 * Its own component because it needs state — a load failure has to be
 * remembered — and CanvasNodeView's other branches are all pure.
 */
function ImageNode({
  props,
  frame,
}: {
  props: NodeProps
  frame: React.CSSProperties
}) {
  // The thumbnail, not the full upload — see ImageNodeProps.thumbUrl for why.
  const src = props.thumbUrl || props.url
  // Keyed on the URL so a node that gets a new image is given a fresh chance.
  // A plain boolean would latch: once one src had failed, the node would keep
  // claiming to be missing even after a redo relinked it to something valid.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = Boolean(src) && failedSrc === src

  // A node whose image 404s. Reachable for real: the orphan-cleanup script can
  // reclaim an object that an undo left unreferenced, and a redo afterwards
  // relinks the node to bytes that are gone. The browser's broken-image glyph
  // in the middle of a crit board says nothing useful, so this does.
  const missing = !src || failed

  return (
    <div style={{ ...frame, overflow: 'hidden', borderRadius: 3 }}>
      {missing ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            padding: 8,
            textAlign: 'center',
            background: ROOM.hairline,
            color: ROOM.ink2,
            fontFamily: SANS_STACK,
            fontSize: 12,
          }}
        >
          {props.name ? `${props.name} is missing` : 'Image unavailable'}
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={props.name || 'Image on the canvas'}
          draggable={false}
          onError={() => setFailedSrc(src)}
          style={{
            width: '100%',
            height: '100%',
            // `contain`, not `cover` or `fill`. The node is created at the
            // picture's own aspect ratio, so all three agree until someone
            // free-resizes — and at that point cover silently crops the work
            // and fill distorts it. Letterboxing is the only one of the three
            // that never lies about what the image is.
            objectFit: 'contain',
            display: 'block',
            // The browser's native image drag-ghost would fight the canvas's
            // own pointer gestures. Hit-testing is geometric (topmostAt over
            // the node array), so this does not affect selecting the node.
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      )}
    </div>
  )
}

/**
 * A straight line or an arrow, drawn corner to corner inside its box.
 *
 * SVG rather than a rotated div: a div would need its own rotation on top of
 * the node's, and the two would fight the moment someone rotated the node
 * itself. Drawing inside the box means resize and rotate work exactly as they
 * do for every other shape, with no special cases in the transform code.
 */
function LineNode({
  node,
  props,
  frame,
}: {
  node: CanvasNode
  props: NodeProps
  frame: React.CSSProperties
}) {
  const stroke = props.stroke || ROOM.ink
  const width = props.size ?? 2
  // A zero extent would give the viewBox a zero dimension and divide by zero
  // when the SVG scales — the same trap MIN_INK_EXTENT guards for ink.
  const w = Math.max(MIN_INK_EXTENT, node.w)
  const h = Math.max(MIN_INK_EXTENT, node.h)
  const swne = props.diagonal === 'swne'
  // Axis-aligned lines run through the centre of their padded box; diagonal
  // ones still run corner to corner. See NodeProps.axis.
  const axis = props.axis ?? 'diagonal'
  const x1 = axis === 'vertical' ? w / 2 : 0
  const x2 = axis === 'vertical' ? w / 2 : w
  const y1 = axis === 'horizontal' ? h / 2 : axis === 'vertical' ? 0 : swne ? h : 0
  const y2 = axis === 'horizontal' ? h / 2 : axis === 'vertical' ? h : swne ? 0 : h

  // Unique per node: two arrows on one canvas sharing a marker id would make
  // the second silently reuse the first's colour.
  const headId = `arrowhead-${node.id}`

  return (
    <div style={{ ...frame, pointerEvents: 'none' }}>
      {/* w/h, not node.w/node.h: a zero on the outer element disables rendering
          outright, so a line saved by an older build with a degenerate box
          still draws. */}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        {props.shape === 'arrow' && (
          <defs>
            {/* userSpaceOnUse so the head keeps its size when the box is
                stretched — a strokeWidth-relative marker on a
                preserveAspectRatio="none" viewBox comes out sheared. */}
            <marker
              id={headId}
              markerUnits="userSpaceOnUse"
              markerWidth={width * 5}
              markerHeight={width * 5}
              refX={width * 4}
              refY={width * 2.5}
              orient="auto"
            >
              <path d={`M 0 0 L ${width * 5} ${width * 2.5} L 0 ${width * 5} z`} fill={stroke} />
            </marker>
          </defs>
        )}
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={width}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          markerEnd={props.shape === 'arrow' ? `url(#${headId})` : undefined}
        />
      </svg>
    </div>
  )
}
