'use client'

import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { ArrowRight, Boxes, MessageSquareText, Network } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import AvatarMenu from '@/components/AvatarMenu'
import DemoBanner from '@/components/DemoBanner'
import GalleryAvatarModal, { type AvatarFormValues } from '@/components/GalleryAvatarModal'
import { Button, Card, StatusState } from '@/components/ui'
import { isDemoMode } from '@/lib/demoMode'
import { supabase } from '@/lib/supabase/client'

const features = [
  {
    title: 'Studio rooms',
    description: 'Keep boards, references, and reviews together in spatial rooms built for visual work.',
    icon: Boxes,
  },
  {
    title: 'Connected community',
    description: 'Move through a living network of people, projects, departments, and shared spaces.',
    icon: Network,
  },
  {
    title: 'Feedback in context',
    description: 'Collect comments and critique beside the work, where the next decision is easiest to see.',
    icon: MessageSquareText,
  },
]

function HomeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const institutionFromUrl = searchParams?.get('institution') ?? null
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [institutionSlug, setInstitutionSlug] = useState<string | null>(null)

  const isDemo = isDemoMode(searchParams)

  useEffect(() => {
    if (institutionFromUrl) {
      window.sessionStorage.setItem('pinspace_institution', institutionFromUrl)
      // sessionStorage is unavailable during server rendering; update after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstitutionSlug(institutionFromUrl)
    } else {
      setInstitutionSlug(window.sessionStorage.getItem('pinspace_institution'))
    }
  }, [institutionFromUrl])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => setUser(session?.user || null),
    )

    return () => subscription.unsubscribe()
  }, [])

  const handleEnterGallery = (values: AvatarFormValues) => {
    const params = new URLSearchParams({
      color: values.color,
      appearance: values.appearance,
      department: values.department,
      year: values.year,
    })
    if (isDemo) params.set('demo', 'true')
    setShowGalleryModal(false)
    router.push(`/gallery?${params.toString()}`)
  }

  const signInHref = institutionSlug ? `/sign-in?institution=${institutionSlug}` : '/sign-in'
  const signUpHref = institutionSlug ? `/sign-up?institution=${institutionSlug}` : '/sign-up'

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <DemoBanner />
      <header className="border-b border-border bg-background-light/90">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-kova px-2 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Kova
          </Link>
          <nav aria-label="Account" className="flex min-w-0 items-center gap-2 sm:gap-3">
            {loading ? (
              <StatusState
                status="loading"
                title="Checking your session"
                className="border-0 bg-transparent p-2 text-xs shadow-none"
              />
            ) : user ? (
              <>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-11 items-center rounded-kova border border-primary-dark bg-primary px-3 text-sm font-semibold text-kova-ink shadow-[var(--shadow-soft)] transition-transform active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-4"
                >
                  Open dashboard
                </Link>
                <AvatarMenu
                  email={user.email || user.user_metadata?.email}
                  onSignOut={() => supabase.auth.signOut().then(() => {
                    router.replace('/')
                    router.refresh()
                  })}
                />
              </>
            ) : (
              <>
                <Link
                  href={signInHref}
                  className="inline-flex min-h-11 items-center rounded-kova px-2 text-sm font-semibold text-text-primary transition-colors hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3"
                >
                  Sign in
                </Link>
                <Link
                  href={signUpHref}
                  className="inline-flex min-h-11 items-center rounded-kova border border-primary-dark bg-primary px-3 text-sm font-semibold text-kova-ink shadow-[var(--shadow-soft)] transition-transform active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-4"
                >
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="relative isolate border-b border-border px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
          <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -right-24 top-12 h-72 w-72 rounded-full border-[3rem] border-primary-muted opacity-70" />
            <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-accent opacity-10" />
          </div>
          <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.62fr)] lg:items-end">
            <div className="max-w-4xl">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-accent">Work in public. Learn together.</p>
              <h1 className="mt-5 text-5xl font-bold leading-[0.94] tracking-tight text-text-primary sm:text-6xl lg:text-8xl">
                Studio work gets stronger when ideas stay connected.
              </h1>
            </div>
            <div className="max-w-xl lg:pb-2">
              <p className="text-lg leading-8 text-text-secondary sm:text-xl">
                Kova brings rooms, boards, people, and critique into one shared spatial network for creative communities.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                {loading ? (
                  <Button type="button" size="lg" disabled>
                    Checking access…
                  </Button>
                ) : (
                  <Link
                    href={user ? '/dashboard' : signUpHref}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-kova border border-primary-dark bg-primary px-5 py-2.5 font-semibold text-kova-ink shadow-[var(--shadow-soft)] transition-transform active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {user ? 'Continue to dashboard' : 'Start your space'} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                )}
                <Button type="button" variant="secondary" size="lg" onClick={() => setShowGalleryModal(true)}>
                  Explore the network
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="how-kova-works" className="px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <div className="max-w-2xl">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-accent">One connected practice</p>
              <h2 id="how-kova-works" className="mt-3 text-3xl font-bold text-text-primary sm:text-4xl">
                From first pin to final review.
              </h2>
            </div>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {features.map(({ title, description, icon: Icon }, index) => (
                <Card key={title} className="flex min-w-0 flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-kova bg-primary-muted text-primary-dark">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <span className="font-mono text-xs font-bold text-text-muted">0{index + 1}</span>
                  </div>
                  <h3 className="mt-7 text-xl font-bold text-text-primary">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />

      <footer className="border-t border-border bg-primary-dark text-background-light">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-7 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Kova. Built for creative communities.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/terms" className="min-h-11 py-3 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Terms of Service
            </Link>
            <Link href="/privacy" className="min-h-11 py-3 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <HomeInner />
    </Suspense>
  )
}
