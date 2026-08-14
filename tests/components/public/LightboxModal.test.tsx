import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { onAuthStateChange, resetViewport } = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  resetViewport: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange,
    },
    channel: vi.fn(),
  },
}))
vi.mock('@/components/useImageViewport', () => ({
  useImageViewport: () => ({
    containerRef: vi.fn(),
    imgRef: { current: null },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isZoomed: false,
    isInteracting: false,
    scaleRef: { current: 1 },
    onImageLoad: vi.fn(),
    reset: resetViewport,
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onDoubleClick: vi.fn(),
    imageFractionToContainerPoint: vi.fn(() => null),
    containerPointToImageFraction: vi.fn(() => null),
    getViewportFraction: vi.fn(() => ({ z: 1, cx: 0.5, cy: 0.5 })),
    applyViewportFraction: vi.fn(),
    setInteractionEnabled: vi.fn(),
  }),
}))

import LightboxModal from '@/components/LightboxModal'
import type { Board } from '@/types'

const board = (id: string, title: string): Board => ({
  id,
  studioId: 'room-1',
  studentName: 'Ada Maker',
  title,
  thumbnailUrl: `/boards/${id}.jpg`,
  fullImageUrl: `/boards/${id}.jpg`,
  uploadedAt: new Date('2026-08-14T00:00:00.000Z'),
})

const first = board('board-1', 'Material study')
const second = board('board-2', 'Assembly study')

function renderLightbox(overrides: Partial<React.ComponentProps<typeof LightboxModal>> = {}) {
  const props: React.ComponentProps<typeof LightboxModal> = {
    board: first,
    allBoards: [first, second],
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  }
  return { ...render(<LightboxModal {...props} />), props }
}

describe('Kova public lightbox chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('exposes a labelled modal with touch-safe native controls', async () => {
    renderLightbox()

    const dialog = await screen.findByRole('dialog', { name: 'Material study' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    for (const name of ['Previous', 'Next', 'Download image', 'Close']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'min-w-11')
    }
  })

  it('keeps arrow navigation and Escape close behavior intact', async () => {
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    renderLightbox({ board: second, onNavigate, onClose })

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onNavigate).toHaveBeenCalledWith('prev')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('contains focus and restores it to the opener when closed', async () => {
    const user = userEvent.setup()
    const opener = document.createElement('button')
    opener.textContent = 'Open board'
    document.body.appendChild(opener)
    opener.focus()

    const result = renderLightbox()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    await user.tab()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)

    result.rerender(
      <LightboxModal board={null} allBoards={[first, second]} onClose={result.props.onClose} onNavigate={result.props.onNavigate} />,
    )
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
