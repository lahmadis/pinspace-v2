'use client'

import { Html } from '@react-three/drei'
import { ExternalLink } from 'lucide-react'
import { consumeDoubleClick } from '@/lib/room/consumeDoubleClick'

interface VideoBadgeProps {
  /** The validated link to open. */
  url: string
  /** Board width in scene units (inches). */
  width: number
  /** Board height in scene units (inches). */
  height: number
}

/**
 * Small link badge overlaid on the top-left corner of a board that has an
 * attached link. Clicking it opens the link in a new tab (noopener,noreferrer)
 * and stops propagation so the board's own click (lightbox / select / drag)
 * never fires. Rendered as an Html overlay so it captures DOM clicks directly
 * rather than competing with the 3D raycaster.
 *
 * Top-left is chosen deliberately: the comment-count bubble and corner resize
 * handles live on the right / other corners, so this stays out of their way and
 * keeps the work itself unobscured.
 */
export default function VideoBadge({ url, width, height }: VideoBadgeProps) {
  const inset = Math.min(width, height) * 0.12

  return (
    <Html
      position={[-width / 2 + inset, height / 2 - inset, 0.06]}
      center
      distanceFactor={10}
      zIndexRange={[60, 0]}
      style={{ pointerEvents: 'auto' }}
    >
      {/* Wrapper, not the button: drei's inner div owns pointerEvents and
          shrink-wraps the button, so the pill's rounded corners hit-test on the
          div. Guarding only the button leaves those few pixels able to bubble
          out and drop the user from wall-edit mode. */}
      <div style={{ display: 'inline-flex' }} onDoubleClick={consumeDoubleClick}>
      <button
        type="button"
        title="Open link"
        aria-label="Open link"
        onClick={(e) => {
          e.stopPropagation()
          window.open(url, '_blank', 'noopener,noreferrer')
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: '9999px',
          border: '1px solid rgba(255,255,255,0.85)',
          background: 'rgba(22,24,29,0.82)',
          color: '#ffffff',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        }}
      >
        {/* Generic link icon */}
        <ExternalLink size={14} strokeWidth={2.25} />
      </button>
      </div>
    </Html>
  )
}
