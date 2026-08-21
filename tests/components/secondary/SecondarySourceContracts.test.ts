import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const presentationFiles = [
  'app/settings/page.tsx',
  'app/admin/page.tsx',
  'app/admin/institutions/[slug]/page.tsx',
  'app/admin/users/page.tsx',
  'app/admin/instructors/[userId]/page.tsx',
  'app/model/page.tsx',
  'app/demo/page.tsx',
  'app/demo/studio/[id]/page.tsx',
  'app/demo/studio/[id]/view/page.tsx',
  'app/debug/boards/page.tsx',
  'components/LegalDocument.tsx',
  'components/DemoBanner.tsx',
  'components/FeedbackButton.tsx',
]

describe('PinSpace secondary-route source contracts', () => {
  it('uses semantic presentation tokens without legacy theme utilities', async () => {
    for (const file of presentationFiles) {
      const source = await readFile(file, 'utf8')
      expect(source, file).not.toMatch(/(?:bg|text|border|ring|from|to|via)-(?:gray|slate|indigo|purple)-/)
    }
  })

  it('uses the shared Dialog for destructive settings and admin ownership flows', async () => {
    const [settings, admin, feedback] = await Promise.all([
      readFile('app/settings/page.tsx', 'utf8'),
      readFile('app/admin/page.tsx', 'utf8'),
      readFile('components/FeedbackButton.tsx', 'utf8'),
    ])

    expect(settings).toContain('<Dialog')
    expect(admin).toContain('<CreateOrgModal')
    expect(feedback).toContain('<Dialog')
    expect(settings).not.toContain('fixed inset-0 bg-black')
    expect(admin).not.toContain('fixed inset-0 bg-black')
  })

  it('keeps denied, loading, error, empty, populated, and role-action states explicit', async () => {
    const [admin, users, instructor, settings] = await Promise.all([
      readFile('app/admin/page.tsx', 'utf8'),
      readFile('app/admin/users/page.tsx', 'utf8'),
      readFile('app/admin/instructors/[userId]/page.tsx', 'utf8'),
      readFile('app/settings/page.tsx', 'utf8'),
    ])

    expect(users).toContain('Access denied')
    expect(admin).toContain('Executive Overview')
    expect(users).toContain('UsersTable')
    expect(instructor).toContain('Instructor not found')
    expect(instructor).toContain('Create studio')
    expect(settings).toContain("toast.error('Failed to save profile')")
    expect(settings).toContain('Leave organization?')
    expect(settings).toContain('Final account deletion confirmation')
  })

  it('keeps utility and demo identity unmistakable', async () => {
    const [model, demo, debug, banner] = await Promise.all([
      readFile('app/model/page.tsx', 'utf8'),
      readFile('app/demo/page.tsx', 'utf8'),
      readFile('app/debug/boards/page.tsx', 'utf8'),
      readFile('components/DemoBanner.tsx', 'utf8'),
    ])

    expect(model).toContain('eyebrow="Utility"')
    expect(demo).toContain('aria-label="PinSpace demo network"')
    expect(debug).toContain('eyebrow="Restricted debug utility"')
    expect(banner).toContain("window.location.pathname.startsWith('/demo')")
  })

  it('keeps admin authorization, error, focus, and navigation states distinct', async () => {
    const [admin, users, instructor, institution, shell, settings, demoEdit, demoView] = await Promise.all([
      readFile('app/admin/page.tsx', 'utf8'),
      readFile('app/admin/users/page.tsx', 'utf8'),
      readFile('app/admin/instructors/[userId]/page.tsx', 'utf8'),
      readFile('app/admin/institutions/[slug]/page.tsx', 'utf8'),
      readFile('components/admin/AdminShell.tsx', 'utf8'),
      readFile('app/settings/page.tsx', 'utf8'),
      readFile('app/demo/studio/[id]/page.tsx', 'utf8'),
      readFile('app/demo/studio/[id]/view/page.tsx', 'utf8'),
    ])

    expect(users).toContain('if (isAdmin === null)')
    expect(admin).toContain('checkAdmin')
    expect(users).toContain('Failed to load users')
    expect(instructor).toContain('loadInstructor')
    expect(institution).toContain('if (error)')
    expect(institution).toContain('encodeURIComponent(slug)')
    expect(shell).toContain("exact: true")
    expect(settings).toContain('deleteInputRef')
    for (const demoStudio of [demoEdit, demoView]) {
      expect(demoStudio).toContain('aria-label="Back to demo network"')
      expect(demoStudio).toContain('<DemoBanner inline')
      expect(demoStudio).toContain('flex-col')
      expect(demoStudio).toContain('flex-wrap')
      expect(demoStudio).not.toContain('top-[calc(env(safe-area-inset-top)+3.5rem)]')
    }
    expect(demoView).toContain('href={`/demo/studio/${studioId}`}')
    expect(demoView).toContain('Edit Mode')
  })

  it('preserves the frozen secondary route API and role guard contracts', async () => {
    const [settings, admin, users, instructor, debug] = await Promise.all([
      readFile('app/settings/page.tsx', 'utf8'),
      readFile('app/admin/page.tsx', 'utf8'),
      readFile('app/admin/users/page.tsx', 'utf8'),
      readFile('app/admin/instructors/[userId]/page.tsx', 'utf8'),
      readFile('app/debug/boards/page.tsx', 'utf8'),
    ])

    expect(settings).toContain("fetch('/api/settings/profile'")
    expect(settings).toContain("fetch('/api/settings/notifications'")
    expect(settings).toContain("fetch('/api/settings/leave-organization'")
    expect(settings).toContain("fetch('/api/settings/delete-account'")
    expect(admin).toContain('getAdminMeApi')
    expect(users).toContain('getAdminUsersApi')
    expect(instructor).toContain("fetch(`/api/admin/instructors/${encodeURIComponent(params.userId)}`")
    expect(debug).toContain("fetch(`/api/debug/boards?workspaceId=${studioId}`)")
  })

  it('labels each tabular scroll region so narrow screens do not overflow the page', async () => {
    for (const file of [
      'app/admin/page.tsx',
      'app/admin/users/page.tsx',
      'app/admin/instructors/[userId]/page.tsx',
    ]) {
      const source = await readFile(file, 'utf8')
      if (!source.includes('<table')) continue
      expect(source, file).toContain('tabIndex={0}')
      expect(source, file).toMatch(/aria-label="[^"]+ table"/)
    }
  })

  it('uses the shared data-table and form primitives across administrative surfaces', async () => {
    for (const file of [
      'app/admin/institutions/[slug]/page.tsx',
      'app/admin/instructors/[userId]/page.tsx',
    ]) {
      const source = await readFile(file, 'utf8')
      expect(source, file).toContain('<DataTable')
      expect(source, file).not.toContain('<table')
      expect(source, file).not.toContain('overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent')
    }

    for (const file of [
      'app/admin/users/page.tsx',
    ]) {
      const source = await readFile(file, 'utf8')
      expect(source, file).toContain('<FormField')
      expect(source, file).toContain('<Input')
      expect(source, file).toContain('<Button')
    }
  })
})
