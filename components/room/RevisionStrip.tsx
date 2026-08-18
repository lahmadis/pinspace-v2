'use client'

import { ROOM, MONO_STACK } from '@/lib/room/palette'

export type RoomView = 'room' | 'unfolded' | 'plan'

export interface RevisionNode {
  /** Delta number shown inside the triangle. */
  number: number
  label: string
  /** Pre-formatted date string; the strip does no locale work of its own. */
  date: string
  status: 'complete' | 'active' | 'future'
}

interface RevisionStripProps {
  view: RoomView
  onViewChange: (view: RoomView) => void
  nodes: RevisionNode[]
  /** e.g. "FALL 2026" — sits at the right end of the rule. */
  semester: string
}

const VIEWS: Array<{ id: RoomView; label: string }> = [
  { id: 'room', label: 'Room' },
  { id: 'unfolded', label: 'Unfolded' },
  { id: 'plan', label: 'Plan' },
]

/**
 * Delta marker — the revision-cloud triangle from construction drawings.
 *
 * Amber is reserved for the active node; complete nodes fill ink2 (muted, but
 * still a filled/solid mark — "this happened"); future nodes stay an outline.
 */
function Delta({ n, status }: { n: number; status: RevisionNode['status'] }) {
  const fill = status === 'active' ? ROOM.amber : status === 'complete' ? ROOM.ink2 : 'transparent'
  const stroke = status === 'future' ? ROOM.hairline : fill
  const textColor = status === 'active' ? ROOM.ink : status === 'complete' ? ROOM.wall : ROOM.ink2

  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: 30, height: 27 }}>
      <svg width="30" height="27" viewBox="0 0 30 27" aria-hidden="true">
        <polygon points="15,2 28,25 2,25" fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <span
        className="absolute tabular-nums"
        style={{ fontFamily: MONO_STACK, fontSize: 11, fontWeight: 700, color: textColor, top: 9 }}
      >
        {n}
      </span>
    </span>
  )
}

/**
 * Bottom chrome: the view switcher sitting directly above the revision strip.
 *
 * A light paper/sheet bar, matching the room's own chrome — only the active
 * view button and the active revision node invert to a filled color (amber
 * for the node, solid ink for the button, mirroring the reference's
 * `.viewtoggle button.active` treatment). Completed milestones read as a
 * filled ink2 mark; future ones stay an outline.
 */
export default function RevisionStrip({ view, onViewChange, nodes, semester }: RevisionStripProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
      {/* View switcher, centred just above the strip. */}
      <div className="flex justify-center pb-3">
        <div
          className="pointer-events-auto flex items-center gap-1 p-1 rounded-full shadow-xl"
          style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
        >
          {VIEWS.map((v) => {
            const isActive = v.id === view
            return (
              <button
                key={v.id}
                onClick={() => onViewChange(v.id)}
                aria-pressed={isActive}
                className="px-5 py-2 rounded-full text-[11px] uppercase tracking-[0.18em] transition-colors"
                style={{
                  fontFamily: MONO_STACK,
                  background: isActive ? ROOM.ink : 'transparent',
                  color: isActive ? ROOM.wall : ROOM.ink2,
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                {v.label}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="pointer-events-auto w-full px-6 py-3"
        style={{ background: ROOM.wall, borderTop: `1px solid ${ROOM.hairline}` }}
      >
        <div className="flex items-center gap-0 max-w-6xl mx-auto">
          {nodes.map((node, i) => (
            <div key={node.number} className="flex items-center" style={{ flex: i === nodes.length - 1 ? '0 0 auto' : '1 1 0' }}>
              <div className="flex items-center gap-2.5 shrink-0">
                <Delta n={node.number} status={node.status} />
                <div className="leading-tight" style={{ opacity: node.status === 'future' ? 0.6 : 1 }}>
                  <div
                    className="text-[10px] uppercase tracking-[0.16em] whitespace-nowrap"
                    style={{
                      fontFamily: MONO_STACK,
                      color: node.status === 'active' ? ROOM.ink : ROOM.ink2,
                      fontWeight: node.status === 'active' ? 700 : 500,
                    }}
                  >
                    {node.label}
                  </div>
                  <div
                    className="text-[10px] tabular-nums"
                    style={{ fontFamily: MONO_STACK, color: node.status === 'active' ? ROOM.ink : ROOM.ink2 }}
                  >
                    {node.date}
                  </div>
                </div>
              </div>
              {/* Connecting rule. Filled ink2 up to the active node, hairline after. */}
              {i < nodes.length - 1 && (
                <div
                  className="flex-1 mx-3"
                  style={{
                    height: 2,
                    background: node.status === 'complete' ? ROOM.ink2 : ROOM.hairline,
                    opacity: node.status === 'complete' ? 1 : 0.6,
                  }}
                />
              )}
            </div>
          ))}

          <div
            className="ml-6 pl-6 shrink-0 text-[11px] uppercase tracking-[0.2em]"
            style={{ fontFamily: MONO_STACK, color: ROOM.ink2, borderLeft: `1px solid ${ROOM.hairline}` }}
          >
            {semester}
          </div>
        </div>
      </div>
    </div>
  )
}
