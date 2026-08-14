import type { Metadata } from 'next'
import { Figtree, JetBrains_Mono } from 'next/font/google'
import * as Sentry from '@sentry/nextjs'
import './globals.css'
import Toaster from '@/components/Toaster'
import { ProfileProviderWrapper } from '@/components/ProfileProviderWrapper'

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export function generateMetadata(): Metadata {
  return {
    title: 'PinSpace - Interactive Studio Network',
    description: 'Explore studio work in immersive 3D spaces. Browse student projects, pin boards to virtual walls, and discover design work from programs across the country.',
    openGraph: {
      title: 'PinSpace - Interactive Studio Network',
      description: 'Explore studio work in immersive 3D spaces.',
      type: 'website',
      siteName: 'PinSpace',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'PinSpace - Interactive Studio Network',
      description: 'Explore studio work in immersive 3D spaces.',
    },
    other: {
      ...Sentry.getTraceData(),
    },
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${figtree.variable} ${jetBrainsMono.variable}`} suppressHydrationWarning>
        <ProfileProviderWrapper>
          {children}
        </ProfileProviderWrapper>
        <Toaster />
      </body>
    </html>
  )
}
