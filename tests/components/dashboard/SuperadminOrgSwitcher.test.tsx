import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SuperadminOrgSwitcher } from '@/components/dashboard/SuperadminOrgSwitcher'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

describe('SuperadminOrgSwitcher', () => {
  beforeEach(() => {
    push.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ orgs: [{ id: 'org/1', name: 'PinSpace School', slug: 'pinspace' }] }),
    }))
  })

  it('associates its visible label and preserves organization navigation', async () => {
    const user = userEvent.setup()
    render(<SuperadminOrgSwitcher />)
    const select = await screen.findByRole('combobox', { name: 'Superadmin organization network' })
    await user.selectOptions(select, 'org/1')
    expect(push).toHaveBeenCalledWith('/explore?org=org%2F1')
  })

  it('stays hidden when the server gate denies access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { container } = render(<SuperadminOrgSwitcher />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
