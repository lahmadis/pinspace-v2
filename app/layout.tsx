import type { Metadata } from 'next'
import * as Sentry from '@sentry/nextjs'
import './globals.css'
import Toaster from '@/components/Toaster'

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
      <body suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
