import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewStudioPage from '@/app/studio/new/page'
import { EditModeOverlay } from '@/components/3d/EditModeOverlay'
import FloorEditorOverlay from '@/components/3d/FloorEditorOverlay'
import PresenceBar from '@/components/3d/PresenceBar'
import QuickNotePanel from '@/components/QuickNotePanel'
import ShareModal from '@/components/ShareModal'
import type { FloorTable } from '@/types'

const { push, toastError } = vi.hoisted(() => ({ push: vi.fn(), toastError: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: toastError, success: vi.fn() } }))
vi.mock('qrcode.react', () => ({ QRCodeCanvas: ({ value }: { value: string }) => <div aria-label={`QR code for ${value}`} /> }))
vi.mock('@/components/3d/WallConfigPreview', () => ({ WallConfigPreview: () => <div aria-label="3D wall preview" /> }))

type FloorWallConfig = ComponentProps<typeof FloorEditorOverlay>['wallConfig']

describe('PinSpace studio controls', () => {
  beforeEach(() => {
    push.mockReset()
    toastError.mockReset()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('validates a new room inline and preserves the workspace API contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspace: { id: 'workspace-1' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewStudioPage />)

    const name = screen.getByLabelText(/room name/i)
    await user.click(screen.getByRole('button', { name: 'Create room' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a room name')
    expect(name).toHaveAttribute('aria-invalid', 'true')

    await user.type(name, '  Material Lab  ')
    await user.type(screen.getByLabelText('Description (optional)'), '  Models and studies  ')
    await user.click(screen.getByRole('button', { name: 'Create room' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workspace/workspace-1'))
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Material Lab', description: 'Models and studies', type: 'personal' }),
    }))
  })

  it('prevents duplicate room creation while the request is pending', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    const pending = new Promise((resolve) => { resolveRequest = resolve })
    const fetchMock = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewStudioPage />)

    await user.type(screen.getByLabelText('Room name'), 'Material Lab')
    const submit = screen.getByRole('button', { name: 'Create room' })
    await user.click(submit)
    expect(screen.getByRole('button', { name: 'Creating room' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Creating room' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveRequest?.({ ok: true, json: async () => ({ id: 'workspace-1' }) })
      await pending
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/workspace/workspace-1'))
  })

  it('exposes wall editing as labelled, touch-sized controls with a keyboard alternative', async () => {
    const user = userEvent.setup()
    const clear = vi.fn()
    render(
      <EditModeOverlay
        isVisible
        wallIndex={1}
        onClose={vi.fn()}
        onUpload={vi.fn()}
        onClearWall={clear}
        wallBoardCount={3}
      />
    )

    expect(screen.getByRole('region', { name: 'Wall editing controls' })).toHaveTextContent(
      'Use pointer, touch, or keyboard controls'
    )
    const clearButton = screen.getByRole('button', { name: 'Clear wall' })
    expect(clearButton.className).toContain('min-h-11')
    await user.click(clearButton)
    await user.click(screen.getByRole('button', { name: 'Confirm clearing 3 boards' }))
    expect(clear).toHaveBeenCalledOnce()
  })

  it('selects, moves, and rotates floor-plan walls from the keyboard', async () => {
    const onWallConfigChange = vi.fn()
    const user = userEvent.setup()

    function Example() {
      const [config, setConfig] = useState<FloorWallConfig>({
        walls: [{ height: 10, width: 8 }],
        layoutType: 'linear' as const,
        customTransforms: [{ x: 0, z: 0, rotationY: 0 }],
      })
      const [tables, setTables] = useState<FloorTable[]>([])
      return (
        <FloorEditorOverlay
          wallConfig={config}
          tables={tables}
          setTables={setTables}
          mode="walls"
          onSaveAndExit={vi.fn()}
          onWallConfigChange={(next) => {
            onWallConfigChange(next)
            setConfig(next)
          }}
        />
      )
    }

    render(<Example />)
    const wall = screen.getByRole('button', { name: /Wall 1/ })
    wall.focus()
    await user.keyboard('{ArrowRight}r')

    await waitFor(() => expect(onWallConfigChange).toHaveBeenCalledTimes(2))
    const latest = onWallConfigChange.mock.calls.at(-1)?.[0]
    expect(latest.customTransforms[0].x).toBe(1)
    expect(latest.customTransforms[0].rotationY).toBeGreaterThan(0)
  })

  it('summarizes long presence lists without exposing email addresses', () => {
    render(
      <PresenceBar
        currentUserId="self"
        users={[
          { userId: 'self', fullName: 'self@example.edu' },
          ...Array.from({ length: 7 }, (_, index) => ({
            userId: `user-${index}`,
            fullName: index === 0 ? 'ada.lovelace@example.edu' : `Studio Collaborator ${index}`,
          })),
        ]}
      />
    )

    expect(screen.getByRole('status', { name: '7 other people editing this room' })).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.queryByTitle('ada.lovelace@example.edu')).not.toBeInTheDocument()
    expect(screen.getByTitle('ada lovelace')).toBeInTheDocument()
  })

  it('uses the shared dialog for sharing and restores trigger focus on Escape', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shareUrl: 'https://example.test/share/abc' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    function Example() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open sharing</button>
          {open && <ShareModal studioId="room-1" onClose={() => setOpen(false)} />}
        </>
      )
    }

    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Open sharing' })
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Share studio' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Share studio' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('labels quick-note fields and guards duplicate submissions', async () => {
    let resolveNote: (() => void) | undefined
    const onAddNote = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveNote = resolve }))
    const user = userEvent.setup()
    render(<QuickNotePanel boardId="board-1" boardTitle="North elevation" onAddNote={onAddNote} />)

    await user.type(screen.getByLabelText('Your name'), 'Ada')
    await user.type(screen.getByLabelText('Critique note'), 'Strengthen the threshold.')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(screen.getByRole('button', { name: 'Adding note' })).toBeDisabled()
    expect(onAddNote).toHaveBeenCalledTimes(1)
    await act(async () => { resolveNote?.() })
    await waitFor(() => expect(screen.getByLabelText('Critique note')).toHaveValue(''))
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
  })
})
