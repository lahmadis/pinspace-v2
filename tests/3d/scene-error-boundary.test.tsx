import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SceneErrorBoundary } from '@/components/3d/SceneErrorBoundary'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

function BrokenScene({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('WebGL failed')
  return <div>Room rendered</div>
}

let transientFailure = false
function TransientScene() {
  if (transientFailure) throw new Error('WebGL failed once')
  return <div>Room rendered</div>
}

describe('SceneErrorBoundary', () => {
  const originalConsoleError = console.error

  afterEach(() => {
    console.error = originalConsoleError
  })

  it('shows an accessible recovery state and retries a transient failure', () => {
    console.error = vi.fn()
    transientFailure = true

    render(
      <SceneErrorBoundary onRetry={() => { transientFailure = false }}>
        <TransientScene />
      </SceneErrorBoundary>
    )

    expect(screen.getByRole('alert')).toHaveTextContent("Room couldn't load")
    fireEvent.click(screen.getByRole('button', { name: /retry room/i }))
    expect(screen.getByText('Room rendered')).toBeInTheDocument()
  })

  it('recovers when its reset key changes', async () => {
    console.error = vi.fn()
    const { rerender } = render(
      <SceneErrorBoundary resetKey="room-a">
        <BrokenScene shouldThrow />
      </SceneErrorBoundary>
    )

    rerender(
      <SceneErrorBoundary resetKey="room-b">
        <BrokenScene shouldThrow={false} />
      </SceneErrorBoundary>
    )

    await waitFor(() => expect(screen.getByText('Room rendered')).toBeInTheDocument())
  })
})

describe('critical 3D canvases', () => {
  it.each([
    'components/3d/StudioRoom.tsx',
    'components/3d/ModelViewer.tsx',
    'app/studio/[id]/view/page.tsx',
    'app/crit/[token]/page.tsx',
    'app/share/[token]/page.tsx',
  ])('protects %s with the scene error boundary', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(source).toContain('<SceneErrorBoundary')
  })
})
