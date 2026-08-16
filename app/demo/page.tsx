'use client'

import { useState } from 'react'
import NetworkView from '@/components/network/NetworkView'
import DemoBanner from '@/components/DemoBanner'
import { getSchools, type DemoSchool } from '@/lib/mockData'
import { School } from '@/types'
import { useRouter } from 'next/navigation'

export default function DemoNetworkPage() {
  const router = useRouter()
  const [selectedSchool, setSelectedSchool] = useState<DemoSchool | null>(null)
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  
  const schools = getSchools()

  return (
    <main aria-label="PinSpace demo network" className="relative h-dvh w-full overflow-hidden bg-background">
      {/* Demo Banner */}
      <DemoBanner message="Demo Mode - Explore Sample Studios" />
      
      {/* Network View */}
      <div className="h-dvh w-full pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        <NetworkView
          schools={schools}
          selectedSchool={selectedSchool}
          selectedYear={selectedYear}
          selectedStudio={null}
          onSelectSchool={(school: School) => {
            setSelectedSchool(school as DemoSchool)
            setSelectedYear(null)
          }}
          onSelectYear={(yearId: string) => {
            setSelectedYear(yearId)
          }}
          onSelectStudio={(studioId: string) => {
            // Navigate to demo studio room
            router.push(`/demo/studio/${studioId}`)
          }}
        />
      </div>
      
      {/* Info Card */}
      <aside aria-label="About this demo" className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-4 right-4 z-40 max-h-[42dvh] overflow-y-auto rounded-pinspace-lg border-2 border-pinspace-ink bg-background-card p-4 shadow-[var(--shadow-raised)] sm:left-auto sm:right-6 sm:max-w-sm sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-black">
          <span aria-hidden="true">🎓</span>
          <span>Welcome to the PinSpace demo</span>
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Explore sample studios from MIT, Harvard, Cornell, and Yale.
          Click through the bubbles to see 3D studio rooms with student work.
        </p>
        <div className="space-y-2 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            <span>4 schools • 40 studios • 600 boards</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
            <span>Fully interactive 3D rooms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-pinspace-ink" aria-hidden="true" />
            <span>Comments & feedback system</span>
          </div>
        </div>
      </aside>
    </main>
  )
}
