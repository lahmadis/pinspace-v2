import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, push, refresh, replace, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  searchParams: new URLSearchParams(),
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    setSession: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace }),
  useSearchParams: () => searchParams,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null }),
        }),
      }),
    }),
  },
}))

vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}))

vi.mock('@/components/GalleryAvatarModal', () => ({
  default: ({
    isOpen,
    onClose,
    onEnter,
  }: {
    isOpen: boolean
    onClose: () => void
    onEnter: (values: { color: string; appearance: string; department: string; year: string }) => void
  }) => isOpen ? (
    <div role="dialog" aria-label="Create your gallery avatar">
      <button type="button" onClick={onClose}>Close avatar setup</button>
      <button
        type="button"
        onClick={() => onEnter({
          color: 'yellow',
          appearance: 'casual',
          department: 'architecture',
          year: 'year-1',
        })}
      >
        Enter gallery
      </button>
    </div>
  ) : null,
}))

vi.mock('@/components/AvatarMenu', () => ({
  default: ({ email }: { email?: string }) => <button type="button">Account {email}</button>,
}))

vi.mock('@/components/DemoBanner', () => ({
  default: () => null,
}))

import ForgotPasswordPage from '@/app/forgot-password/page'
import Home from '@/app/page'
import ResetPasswordPage from '@/app/reset-password/page'
import SignInPage from '@/app/sign-in/page'
import SignUpPage from '@/app/sign-up/[[...sign-up]]/page'
import OnboardingPage from '@/app/onboarding/page'

function authSubscription() {
  return { data: { subscription: { unsubscribe: vi.fn() } } }
}

describe('PinSpace entry flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Array.from(searchParams.keys())) searchParams.delete(key)
    sessionStorage.clear()
    auth.getSession.mockResolvedValue({ data: { session: null } })
    auth.onAuthStateChange.mockReturnValue(authSubscription())
    auth.signInWithPassword.mockResolvedValue({ error: null })
    auth.signInWithOtp.mockResolvedValue({ error: null })
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null })
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    auth.updateUser.mockResolvedValue({ error: null })
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error('invalid') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ institutions: [] }),
    }))
  })

  it('keeps the approved landing composition stable while checking a signed-out session', async () => {
    let finishSession!: (value: unknown) => void
    auth.getSession.mockReturnValue(new Promise((resolve) => { finishSession = resolve }))

    render(<Home />)
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('pinspace.')
    expect(screen.getByText('Explore studios in immersive 3D')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enter the network' })).toBeEnabled()

    await act(async () => finishSession({ data: { session: null } }))
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/sign-in?redirect=%2Fdashboard',
    )
    expect(screen.getByRole('link', { name: 'Sign in to PinSpace' })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByText('From first pin to final review.')).not.toBeInTheDocument()
  })

  it('shows authenticated landing controls when a session exists', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { email: 'maker@example.edu', user_metadata: {} } } },
    })

    render(<Home />)
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('button', { name: /account maker@example.edu/i })).toBeInTheDocument()
  })

  it('preserves institution and demo context across landing actions', async () => {
    const user = userEvent.setup()
    searchParams.set('institution', 'north-school')
    searchParams.set('demo', 'true')

    render(<Home />)

    const dashboard = await screen.findByRole('link', { name: 'Dashboard' })
    expect(dashboard).toHaveAttribute(
      'href',
      '/sign-in?institution=north-school&redirect=%2Fdashboard',
    )
    expect(screen.getByRole('link', { name: 'Sign in to PinSpace' })).toHaveAttribute(
      'href',
      '/sign-in?institution=north-school',
    )

    await user.click(screen.getByRole('button', { name: 'Enter the network' }))
    expect(screen.getByRole('dialog', { name: 'Create your gallery avatar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enter gallery' }))
    expect(push).toHaveBeenCalledWith(
      '/gallery?color=yellow&appearance=casual&department=architecture&year=year-1&demo=true',
    )
  })

  it('recovers to signed-out landing actions when the session check fails', async () => {
    auth.getSession.mockRejectedValue(new Error('Session service unavailable'))

    render(<Home />)

    expect(await screen.findByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/sign-in?redirect=%2Fdashboard',
    )
    expect(screen.queryByRole('status', { name: /checking your session/i })).not.toBeInTheDocument()
  })

  it('preserves a safe redirect and institution context after password sign-in', async () => {
    const user = userEvent.setup()
    searchParams.set('redirect', '/join/ABC123?from=sign-in')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/lookup-domain') {
        return { ok: true, json: async () => ({ orgs: [{ id: 'org-1', slug: 'school' }] }) }
      }
      return { ok: true, json: async () => ({ user_id: 'user-1' }) }
    }))

    render(<SignInPage />)
    await user.type(await screen.findByLabelText('Email'), 'maker@example.edu')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/join/ABC123?from=sign-in'))
    expect(sessionStorage.getItem('pinspace_institution')).toBe('school')
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'maker@example.edu',
      password: 'correct horse',
    })
  })

  it('routes a signed-in user without a profile through onboarding', async () => {
    const user = userEvent.setup()
    searchParams.set('redirect', '/workspace/room-1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/lookup-domain') {
        return { ok: true, json: async () => ({ orgs: [] }) }
      }
      return { ok: true, json: async () => ({}) }
    }))

    render(<SignInPage />)
    await user.type(await screen.findByLabelText('Email'), 'maker@example.edu')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      '/onboarding?redirect=%2Fworkspace%2Froom-1',
    ))
  })

  it('associates sign-in errors with fields and announces client validation', async () => {
    const user = userEvent.setup()
    render(<SignInPage />)

    const email = await screen.findByLabelText('Email')
    const password = screen.getByLabelText('Password')
    await user.type(email, 'person@example.edu')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Please enter your password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-describedby', expect.stringContaining('sign-in-error'))
  })

  it('verifies OTP without provisioning and preserves a chosen workspace', async () => {
    const user = userEvent.setup()
    auth.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/lookup-domain') {
        return {
          ok: true,
          json: async () => ({
            orgs: [
              { id: 'org-1', name: 'North School', slug: 'north', type: 'university', logo_url: null, network_label: null },
              { id: 'org-2', name: 'South Studio', slug: 'south', type: 'firm', logo_url: null, network_label: 'Design' },
            ],
          }),
        }
      }
      return { ok: true, json: async () => ({ user_id: 'user-1' }) }
    }))

    render(<SignInPage />)
    await user.click(await screen.findByRole('button', { name: 'Sign in with email code instead' }))
    await user.type(screen.getByLabelText('Email'), 'maker@example.edu')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await user.click(await screen.findByRole('button', { name: /South Studio/ }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'maker@example.edu',
      options: { shouldCreateUser: false },
    })
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'maker@example.edu',
      token: '123456',
      type: 'email',
    })
    expect(sessionStorage.getItem('pinspace_institution')).toBe('south')
  })

  it('exposes visible sign-up labels and terms validation before provisioning', async () => {
    const user = userEvent.setup()
    render(<SignUpPage />)

    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    const terms = screen.getByRole('checkbox', { name: /i agree to the terms of service/i })
    expect(terms).toHaveAttribute('id', 'terms-agreement')
    await user.type(screen.getByLabelText('Email'), 'maker@example.edu')
    await user.click(screen.getByRole('button', { name: 'Send verification code' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/agree to the terms/i)
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it('completes email verification and password creation before onboarding', async () => {
    const user = userEvent.setup()
    searchParams.set('redirect', '/join/ABC123')
    auth.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/lookup-domain') {
        return {
          ok: true,
          json: async () => ({ orgs: [{ id: 'org-1', slug: 'school' }] }),
        }
      }
      return { ok: true, json: async () => ({ institutions: [] }) }
    }))

    render(<SignUpPage />)
    await user.type(await screen.findByLabelText('Email'), 'maker@example.edu')
    await user.click(screen.getByRole('checkbox', { name: /i agree/i }))
    await user.click(screen.getByRole('button', { name: 'Send verification code' }))

    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }))
    await user.type(await screen.findByLabelText('Password'), 'correct horse')
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Continue to profile' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding?redirect=%2Fjoin%2FABC123'))
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'maker@example.edu',
      options: { shouldCreateUser: true },
    })
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'maker@example.edu',
      token: '123456',
      type: 'email',
    })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'correct horse' })
    expect(sessionStorage.getItem('pinspace_institution_id')).toBe('org-1')
  })

  it('communicates recovery progress and server guidance', async () => {
    const user = userEvent.setup()
    let finishReset!: (value: unknown) => void
    auth.resetPasswordForEmail.mockReturnValue(new Promise((resolve) => { finishReset = resolve }))
    render(<ForgotPasswordPage />)

    await user.type(await screen.findByLabelText('Email'), 'maker@example.edu')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(screen.getByRole('button', { name: 'Sending reset link…' })).toBeDisabled()

    await act(async () => finishReset({ error: { message: 'Reset service unavailable' } }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reset service unavailable')
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled()
  })

  it('server-renders a deterministic recovery link before restoring institution context', async () => {
    sessionStorage.setItem('pinspace_institution', 'school')

    const serverHtml = renderToString(<ForgotPasswordPage />)
    expect(serverHtml).toContain('href="/sign-in"')
    expect(serverHtml).not.toContain('/sign-in?institution=school')

    render(<ForgotPasswordPage />)
    expect(await screen.findByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      '/sign-in?institution=school',
    )
  })

  it('confirms a successful recovery request without exposing account state', async () => {
    const user = userEvent.setup()
    render(<ForgotPasswordPage />)

    await user.type(await screen.findByLabelText('Email'), 'maker@example.edu')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Reset link sent')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'maker@example.edu',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') }),
    )
  })

  it('provides recovery guidance for an expired reset link', async () => {
    render(<ResetPasswordPage />)

    expect(await screen.findByRole('heading', { name: 'Link expired or invalid' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('updates a recovered password and retains reveal state across both fields', async () => {
    const user = userEvent.setup()
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    render(<ResetPasswordPage />)

    await user.type(await screen.findByLabelText('New password'), 'correct horse')
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse')
    await user.click(screen.getAllByRole('button', { name: 'Show password' })[0])
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Your new password is ready')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'correct horse' })
  })

  it('gives every onboarding field a visible label and preserves native keyboard controls', async () => {
    render(<OnboardingPage />)

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/last name/i)).toHaveAttribute('required')
    expect(screen.getByLabelText(/^I am a/)).toHaveAttribute('required')
    expect(screen.getByLabelText('Age range')).toHaveAttribute('id', 'age-range')
    expect(screen.getByLabelText('How did you hear about PinSpace?')).toHaveAttribute('id', 'how-heard')

    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toHaveAttribute('href', '/')
    await user.tab()
    expect(screen.getByLabelText(/first name/i)).toHaveFocus()
  })

  it('submits the existing onboarding profile contract and redirects safely', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('pinspace_institution_id', 'org-1')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<OnboardingPage />)
    await user.type(await screen.findByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.selectOptions(screen.getByLabelText(/^I am a/), 'Faculty')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(postCall?.[0]).toBe('/api/user-profile')
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      full_name: 'Ada Lovelace',
      role: 'faculty',
      organization_id: 'org-1',
    })
    expect(sessionStorage.getItem('pinspace_institution_id')).toBeNull()
  })
})
