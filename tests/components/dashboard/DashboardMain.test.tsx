import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardMain, type DashboardWorkspace } from '@/components/dashboard/DashboardMain'

/**
 * What this file used to cover — the studio card grid, its actions menu, the
 * archived toggle and the header's create/join buttons — is not in this
 * component any more. The grid is gone (the sidebar is the list of your spaces)
 * and rename/delete/leave/create/join moved to DashboardSidebar with it. Those
 * assertions live there now; these cover what the pane actually renders.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

function workspace(overrides: Partial<DashboardWorkspace> = {}): DashboardWorkspace {
  return {
    id: 'workspace-1',
    name: 'North Studio',
    slug: 'north-studio',
    type: 'personal',
    createdBy: 'owner-1',
    studioId: 'studio-1',
    members: [],
    inviteCode: 'ABC123',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    isPublic: false,
    isArchived: false,
    archivedAt: null,
    owner_id: 'owner-1',
    board_count: 3,
    room_count: 2,
    ...overrides,
  }
}

const baseProps = {
  scope: 'personal' as const,
  institutionHome: null,
  loading: false,
  organization: null,
  // Which studio the top bar's switcher points at; the pane falls back to
  // the newest live one when nothing is chosen, which is what these cover.
  currentWorkspaceId: null,
}

/** The roster endpoint the Current studio card fetches on mount. */
function stubRoster(body: unknown = { students: [], total: 0, pinned: 0 }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardMain', () => {
  it('leads with the current studio and opens the network, on the personal tab', async () => {
    stubRoster({
      students: [
        { id: 's1', name: 'Amara Osei', initials: 'AO', boardCount: 2 },
        { id: 's2', name: 'Lena Chen', initials: 'LC', boardCount: 0 },
      ],
      total: 2,
      pinned: 1,
    })

    render(<DashboardMain {...baseProps} rooms={[workspace()]} />)

    // Personal has no seal and no accent — the word is the whole card.
    expect(screen.getByText('Personal')).toBeInTheDocument()

    expect(screen.getByText('Current studio')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'North Studio' })).toBeInTheDocument()
    expect(screen.getByText('2 rooms · 3 boards')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Enter Your Section/ })).toHaveAttribute(
      'href',
      '/workspace/workspace-1'
    )

    // One label on both tabs now: the org scope said "Enter the archives"
    // while pointing at /explore, which is the network, not /archive.
    expect(screen.getByRole('link', { name: /Enter the Network/ })).toHaveAttribute(
      'href',
      '/network'
    )
    // The EMPTY shelf still says where a pin comes from, and goes there. It is
    // an onboarding tile: once anything is pinned it stops rendering, which is
    // what the next case covers.
    expect(screen.getByRole('link', { name: /Pin from the Network/ })).toHaveAttribute(
      'href',
      '/network'
    )

    // Roster arrives after the fetch resolves: who is up, who is not.
    expect(await screen.findByText('Amara Osei')).toBeInTheDocument()
    expect(screen.getByText('2 boards')).toBeInTheDocument()
    expect(screen.getByText('Lena Chen')).toBeInTheDocument()
    expect(screen.getByText('not yet')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 pinned')).toBeInTheDocument()
  })

  it('brands the institution tab and names the section studio-then-surname', () => {
    stubRoster()

    render(
      <DashboardMain
        {...baseProps}
        scope="wentworth"
        organization={{ name: 'Wentworth Institute of Technology', slug: 'wit' }}
        rooms={[
          workspace({
            type: 'class',
            name: 'Section 01 - Tavares',
            instructor: 'Tavares',
            network_metadata: { studio: 'Studio 01' },
          }),
        ]}
      />
    )

    // Short name plus the brand's own second line — not the full page title.
    expect(screen.getByText('Wentworth')).toBeInTheDocument()
    expect(screen.getByText('School of Architecture & Design')).toBeInTheDocument()

    // Studio AND surname: a department runs eight sections of Studio 01, so
    // the studio alone names the course rather than the one you are in. Built
    // here from the two parts — not read off the stored 'Section 01 - Tavares',
    // which leads with the wrong half for this card.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Studio 01 - Tavares' })
    ).toBeInTheDocument()
    // And exactly once: the instructor left the meta line when it reached the
    // heading, rather than being printed twice three lines apart.
    expect(screen.getByText('2 rooms · 3 boards')).toBeInTheDocument()

    // Same label as the personal tab; only the href is per-scope.
    expect(screen.getByRole('link', { name: /Enter the Network/ })).toHaveAttribute(
      'href',
      '/explore?institution=wit'
    )
  })

  it('leaves a pre-studio section on its stored name, without doubling the surname', () => {
    stubRoster()

    render(
      <DashboardMain
        {...baseProps}
        rooms={[workspace({ type: 'class', name: 'Section 03 - Lahmadi', instructor: 'Sarah Lahmadi' })]}
      />
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Section 03 - Lahmadi' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Lahmadi - Lahmadi/)).not.toBeInTheDocument()
  })

  it('drops the onboarding pin tile once the shelf has something on it', async () => {
    // Two endpoints, two bodies: the roster card and the pin shelf both fetch
    // on mount, and stubRoster answers every call with the same object — which
    // would leave the shelf empty and pass this test for the wrong reason.
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/api/pinspaces')
            ? { pins: [{ boardId: 'b1', title: 'Site model', thumbnailUrl: null, fullImageUrl: null, roomId: 'r1', workspaceId: 'workspace-1', author: 'Amara Osei' }] }
            : { students: [], total: 0, pinned: 0 },
      })
    ))

    render(<DashboardMain {...baseProps} rooms={[workspace()]} />)

    // The pinned tile arrives...
    // By its unpin control, which carries an explicit aria-label. The tile
    // button itself is named by its contents, which differ with whether a
    // thumbnail resolved.
    expect(await screen.findByRole('button', { name: 'Unpin Site model' })).toBeInTheDocument()
    // ...and the tile that told you how to get one is gone with it.
    expect(screen.queryByRole('link', { name: /Pin from the Network/ })).not.toBeInTheDocument()
    // The line under the shelf switches with it.
    expect(screen.getByText(/Open a pin to look at it/)).toBeInTheDocument()
  })

  it('points at the sidebar when there is nothing to be current in', () => {
    stubRoster()

    render(<DashboardMain {...baseProps} rooms={[]} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here yet' })).toBeInTheDocument()
    expect(screen.queryByText('Current studio')).not.toBeInTheDocument()
    // The network is an entry point, not content — it renders whether or not
    // you have any studios. This is the regression that once deleted it for
    // every user with an empty dashboard.
    expect(screen.getByRole('link', { name: /Enter the Network/ })).toBeInTheDocument()
  })

  it('holds the current-studio slot while the workspaces load', () => {
    stubRoster()

    render(<DashboardMain {...baseProps} rooms={[]} loading />)

    expect(screen.queryByText('Current studio')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nothing here yet' })).not.toBeInTheDocument()
  })
})
