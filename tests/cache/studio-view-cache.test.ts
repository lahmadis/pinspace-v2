import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStudioViewCache,
  getCachedStudioData,
  prefetchStudioView,
} from '@/lib/studioViewCache'

describe('studio view prefetch cache', () => {
  beforeEach(() => {
    clearStudioViewCache()
    vi.restoreAllMocks()
  })

  it('fetches boards by room id and wall config by workspace id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ boards: [{ id: 'board-1' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            config: { walls: [{ height: 12, width: 18 }], layoutType: 'linear' },
          }),
          { status: 200 }
        )
      )

    await prefetchStudioView('room-1', false, 'workspace-1')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/boards?roomId=room-1')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/studios/workspace-1/wall-config'
    )
    expect(getCachedStudioData('room-1', false)).toMatchObject({
      boards: [{ id: 'board-1' }],
      wallConfig: {
        walls: [{ height: 12, width: 18 }],
        layoutType: 'linear',
      },
    })
  })

  it('does not poison the cache when the boards request fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    await prefetchStudioView('room-2', false, 'workspace-2')

    expect(getCachedStudioData('room-2', false)).toBeNull()
  })

  it('leaves wall config empty when prefetch cannot load the real config', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ boards: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    await prefetchStudioView('room-3', true, 'workspace-3')

    expect(getCachedStudioData('room-3', true)).toMatchObject({
      boards: [],
      wallConfig: null,
    })
  })

  it('does not repopulate the cache from a request cleared while in flight', async () => {
    let resolveBoards!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveBoards = resolve })
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    const pending = prefetchStudioView('room-4', false, 'workspace-4')
    clearStudioViewCache()
    resolveBoards(
      new Response(JSON.stringify({ boards: [{ id: 'late-board' }] }), { status: 200 })
    )
    await pending

    expect(getCachedStudioData('room-4', false)).toBeNull()
  })
})
