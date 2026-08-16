import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { auditSource, auditTree } from '../../scripts/check-pinspace-ui.mjs'

function rules(source: string, file = 'components/Fixture.tsx') {
  return auditSource(source, file).map((issue) => issue.rule)
}

describe('PinSpace UI source audit', () => {
  it.each([
    ['legacy-theme-class', '<div className="bg-indigo-600 text-slate-100" />'],
    ['legacy-hex', 'const selected = "#4444ff"'],
    ['raw-pinspace-color', 'const accent = "#FFC800"'],
    ['raw-pinspace-color', 'const accent = "rgb(255 200 0 / 0.4)"'],
    ['raw-status-class', '<p className="text-red-700">Failed</p>'],
    ['non-semantic-click', '<div onClick={openPanel}>Open</div>'],
    ['hover-only-action', '<button className="opacity-0 group-hover:opacity-100">Delete</button>'],
    ['custom-control-a11y', '<div role="button" onClick={save}>Save</div>'],
    ['fixed-viewport', '<main className="w-[1440px] h-[900px]" />'],
    ['obsolete-ui-import', "import Button from '@/components/Button'"],
    ['raw-data-table', '<table><tbody><tr><td>Account</td></tr></tbody></table>'],
  ])('flags %s violations', (rule, source) => {
    expect(rules(source)).toContain(rule)
  })

  it('accepts semantic PinSpace tokens and accessible native controls', () => {
    const source = `
      export function Fixture() {
        return <button className="min-h-11 bg-primary text-pinspace-ink focus-visible:ring-2">Save</button>
      }
    `

    expect(auditSource(source, 'components/Fixture.tsx')).toEqual([])
  })

  it('allows the native table implementation only inside the shared DataTable primitive', () => {
    expect(rules('<table aria-label="People" />', 'components/ui/DataTable.tsx')).not.toContain('raw-data-table')
  })

  it('allows PinSpace palette literals only in token definition files', () => {
    const source = ':root { --color-primary: 255 200 0; }\\n.pinspace { color: #FFC800; }'

    expect(auditSource(source, 'app/globals.css')).toEqual([])
  })

  it('rejects inline raw-color allowlists in favor of reviewed named palettes', () => {
    const source = `
      // pinspace-ui-allow raw-color -- WebGL material needs a stable sRGB value for scene contrast.
      context.fillStyle = '#ffffff'
    `

    expect(rules(source, 'components/PDFRenderer.tsx')).toEqual(expect.arrayContaining(['invalid-allowlist', 'raw-color']))
  })

  it('does not treat allowlist text inside a runtime string as a comment directive', () => {
    const source = `
      const note = "pinspace-ui-allow raw-color -- ordinary UI color override"
      const accent = '#FFC800'
    `

    expect(rules(source, 'components/Fixture.tsx')).toContain('raw-pinspace-color')
  })

  it('does not treat comment-shaped lines inside a template literal as directives', () => {
    const source = `
      const note = \`
      // pinspace-ui-allow raw-color -- ordinary UI color override
      context.fillStyle = '#ffffff'
      \`
    `

    expect(rules(source, 'components/PDFRenderer.tsx')).toContain('raw-color')
  })

  it.each(['app/globals.css', 'tailwind.config.js'])('never permits legacy hex in %s', (file) => {
    expect(rules('.legacy { color: #4444ff }', file)).toContain('legacy-hex')
  })

  it('includes the active Tailwind config in a whole-tree audit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pinspace-ui-check-'))
    try {
      await mkdir(join(root, 'app'))
      await mkdir(join(root, 'components'))
      await writeFile(join(root, 'tailwind.config.js'), 'export default { legacy: "#3333ee" }')

      expect((await auditTree(root)).map((finding) => finding.rule)).toContain('legacy-hex')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts a documented exported engine palette', () => {
    const source = [
      '/** WebGL material colors are fixed sRGB values chosen for visible scene contrast. */',
      'export const ENGINE_PALETTE = {',
      "  paper: '#ffffff',",
      "  selection: '#FFC800',",
      '}',
    ].join('\n')

    expect(auditSource(source, 'components/3d/enginePalette.ts')).toEqual([])
  })

  it('ignores color examples that appear only in comments', () => {
    expect(auditSource('// White material example: #FFFFFF', 'components/3d/Fixture.tsx')).toEqual([])
  })

  it('does not accept broad or unexplained allowlists', () => {
    const source = `
      // pinspace-ui-allow raw-color
      const SCENE_KEY_LIGHT = '#ffffff'
    `

    expect(rules(source, 'components/3d/Fixture.tsx')).toContain('invalid-allowlist')
  })

  it('accepts a fully accessible custom control', () => {
    const source = `
      <div
        role="button"
        tabIndex={0}
        aria-label="Move table"
        onClick={moveTable}
        onKeyDown={moveTableWithKeyboard}
        className="focus-visible:ring-2"
      />
    `

    expect(auditSource(source, 'components/Fixture.tsx')).toEqual([])
  })

  it('rejects non-color allowlists even when they include a rationale', () => {
    const source = `
      {/* pinspace-ui-allow non-semantic-click -- Event boundary prevents dialog backdrop dismissal. */}
      <div onClick={(event) => event.stopPropagation()} />
    `

    expect(rules(source, 'components/Fixture.tsx')).toContain('invalid-allowlist')
  })

  it('does not treat a propagation-only event boundary as a clickable control', () => {
    const source = '<div onClick={(event) => event.stopPropagation()}><button>Save</button></div>'

    expect(auditSource(source, 'components/Fixture.tsx')).toEqual([])
  })

  it('accepts the reviewed Lightbox backdrop handler only in its exact source file', () => {
    const source = '<div onClick={handleBackdropClick} />'

    expect(auditSource(source, 'components/LightboxModal.tsx')).toEqual([])
  })

  it('accepts a reviewed Lightbox event-containment surface with propagation-only handlers', () => {
    const source = '<div className="absolute top-3 right-3 z-40 pointer-events-auto" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} />'

    expect(auditSource(source, 'components/LightboxModal.tsx')).toEqual([])
  })

  it('accepts the reviewed pointer hit area only with its exact keyboard-equivalent handler', () => {
    const source = '<div aria-hidden="true" onPointerDown={(event) => handleRotateTable(table.id, event)} onClick={(event) => event.stopPropagation()} />'

    expect(auditSource(source, 'components/3d/FloorEditorOverlay.tsx')).toEqual([])
  })

  it('does not let arbitrary data attributes bypass semantic controls', () => {
    const source = '<div data-pinspace-event-boundary="Deletes the entire account forever" onClick={deleteAccount} />'

    expect(rules(source, 'components/Fixture.tsx')).toContain('non-semantic-click')
  })

  it('does not exempt an actionable pointer handler paired with a propagation click handler', () => {
    const source = '<div onPointerDown={deleteAccount} onClick={(event) => event.stopPropagation()} />'

    expect(rules(source, 'components/Fixture.tsx')).toContain('non-semantic-click')
  })

  it('does not hide an action behind a reviewed Lightbox boundary class', () => {
    const source = '<div className="absolute top-3 right-3 z-40 pointer-events-auto" onPointerDown={deleteAccount} onClick={(event) => event.stopPropagation()} />'

    expect(rules(source, 'components/LightboxModal.tsx')).toContain('non-semantic-click')
  })

  it('never permits legacy highlight colors inside an approved engine palette', () => {
    const source = [
      '/** WebGL material colors are fixed sRGB values chosen for visible scene contrast. */',
      'export const ENGINE_PALETTE = {',
      "  selection: '#4444ff',",
      '}',
    ].join('\n')

    expect(rules(source, 'components/3d/enginePalette.ts')).toContain('legacy-hex')
  })

  it('does not approve arbitrary exported palettes based only on a nearby comment', () => {
    const source = [
      '/** WebGL material colors are fixed sRGB values chosen for visible scene contrast. */',
      'export const UNREVIEWED_PALETTE = {',
      "  paper: '#ffffff',",
      '}',
    ].join('\n')

    expect(rules(source, 'components/3d/enginePalette.ts')).toContain('raw-color')
  })
})
