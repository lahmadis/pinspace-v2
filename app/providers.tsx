'use client'

import type { ReactNode } from 'react'

// No global provider needed now; keep as passthrough.
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>
}

