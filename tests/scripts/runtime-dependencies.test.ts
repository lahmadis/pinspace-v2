import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Lockfile {
  packages: Record<string, { version?: string }>
}

describe('React 3D runtime dependency alignment', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lockfile

  it('pins one supported React 19 and React Three Fiber generation', () => {
    expect(manifest.dependencies).toMatchObject({
      react: '19.2.8',
      'react-dom': '19.2.8',
      '@react-three/fiber': '9.7.0',
      '@react-three/drei': '10.7.8',
    })
  })

  it('does not install a second React runtime below a dependency', () => {
    const nestedReactRuntimes = Object.keys(lockfile.packages).filter(
      (path) => path !== 'node_modules/react' && path.endsWith('/node_modules/react'),
    )

    expect(nestedReactRuntimes).toEqual([])
  })
})
