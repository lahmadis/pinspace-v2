'use client'

import { Html } from '@react-three/drei'

interface VideoBadgeProps {
  /** The validated video link to open. */
  url: string
  /** Board width in scene units (inches). */
  width: number
  /** Board height in scene units (inches). */
  height: number
}

/**
 * Small play-button badge overlaid on the top-left corner of a board that has
 * a video link. Clicking it opens the link in a new tab (noopener,noreferrer)
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
      <button
        type="button"
        title="Open video"
        aria-label="Open video"
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
          background: 'rgba(15,23,42,0.78)',
          color: '#ffffff',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        }}
      >
        {/* Play triangle */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}>
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </Html>
  )
}
