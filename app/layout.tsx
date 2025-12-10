import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PinSpace v2 - Interactive Architecture Studio Network',
  description: 'Explore architecture studio work in immersive 3D spaces',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
