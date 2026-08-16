import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sentryInit } = vi.hoisted(() => ({ sentryInit: vi.fn() }))

vi.mock('@sentry/nextjs', () => ({
  init: sentryInit,
  replayIntegration: vi.fn(() => ({ name: 'Replay' })),
  captureRouterTransitionStart: vi.fn(),
}))

const targets = [
  {
    name: 'client',
    tierVariable: 'NEXT_PUBLIC_PINSPACE_DEPLOYMENT_TIER',
    optInVariable: 'NEXT_PUBLIC_PINSPACE_ENABLE_TELEMETRY',
    load: () => import('../../instrumentation-client'),
  },
  {
    name: 'server',
    tierVariable: 'PINSPACE_DEPLOYMENT_TIER',
    optInVariable: 'PINSPACE_ENABLE_TELEMETRY',
    load: () => import('../../sentry.server.config'),
  },
  {
    name: 'edge',
    tierVariable: 'PINSPACE_DEPLOYMENT_TIER',
    optInVariable: 'PINSPACE_ENABLE_TELEMETRY',
    load: () => import('../../sentry.edge.config'),
  },
] as const

const matrices = [
  { name: 'development', nodeEnv: 'development', tier: 'production', optIn: '1', expected: false },
  { name: 'preview', nodeEnv: 'production', tier: 'preview', optIn: '1', expected: false },
  { name: 'production without opt-in', nodeEnv: 'production', tier: 'production', optIn: '0', expected: false },
  { name: 'explicit production opt-in', nodeEnv: 'production', tier: 'production', optIn: '1', expected: true },
] as const

describe('Sentry telemetry boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    sentryInit.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  for (const target of targets) {
    for (const matrix of matrices) {
      it(`${target.name} is ${matrix.expected ? 'enabled' : 'disabled'} for ${matrix.name}`, async () => {
        vi.stubEnv('NODE_ENV', matrix.nodeEnv)
        vi.stubEnv(target.tierVariable, matrix.tier)
        vi.stubEnv(target.optInVariable, matrix.optIn)

        await target.load()

        expect(sentryInit).toHaveBeenCalledOnce()
        expect(sentryInit).toHaveBeenCalledWith(expect.objectContaining({
          enabled: matrix.expected,
          sendDefaultPii: false,
        }))
      })
    }
  }
})
