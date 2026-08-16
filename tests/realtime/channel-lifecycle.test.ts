import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}

describe('realtime channel lifecycle', () => {
  it.each([
    'app/studio/[id]/page.tsx',
    'app/crit/[token]/page.tsx',
  ])('owns and clears the trace stream map for %s', (file) => {
    const contents = source(file)
    expect(contents).toContain('const traceStreams = traceStreamRef.current')
    expect(contents).toContain('traceStreams.clear()')
  })

  it.each([
    'app/studio/[id]/page.tsx',
    'app/crit/[token]/page.tsx',
  ])('does not let stale cleanup clear a replacement live channel in %s', (file) => {
    expect(source(file)).toContain(
      'if (liveChannelRef.current === channel) liveChannelRef.current = null'
    )
  })

  it('removes the studio board and comment subscriptions on effect cleanup', () => {
    const contents = source('app/studio/[id]/page.tsx')
    expect(contents).toContain('if (channel) supabase.removeChannel(channel)')
    expect(contents).toContain('if (commentsChannel) supabase.removeChannel(commentsChannel)')
  })

  it('cancels the guest boards refetch timer on live-channel cleanup', () => {
    const contents = source('app/crit/[token]/page.tsx')
    expect(contents).toContain('clearTimeout(boardsRefetchTimerRef.current)')
    expect(contents).toContain('boardsRefetchTimerRef.current = null')
  })
})
