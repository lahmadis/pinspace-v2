'use client'

import { Suspense, useState } from 'react'
import NetworkView from '@/components/network/NetworkView'
import DemoBanner from '@/components/DemoBanner'
import { getSchools, getYearsBySchool, getStudiosByYear, type DemoSchool } from '@/lib/mockData'
import { School } from '@/types'

function DemoNetworkPageInner() {
  const [selectedSchool, setSelectedSchool] = useState<DemoSchool | null>(null)
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  
  const schools = getSchools()

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Demo Banner */}
      <DemoBanner message="Demo Mode - Explore Sample Architecture Studios" />
      
      {/* Network View */}
      <div className="pt-16 w-full h-[calc(100vh-4rem)]">
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
            window.location.href = `/demo/studio/${studioId}`
          }}
        />
      </div>
      
      {/* Info Card */}
      <div className="fixed bottom-6 right-6 bg-white rounded-xl shadow-2xl p-6 max-w-sm border-2 border-yellow-400 z-50">
        <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
          <span>🎓</span>
          <span>Welcome to PinSpace Demo</span>
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Explore sample architecture studios from MIT, Harvard, Cornell, and Yale. 
          Click through the bubbles to see 3D studio rooms with student work.
        </p>
        <div className="space-y-2 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
            <span>4 schools • 40 studios • 600 boards</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-pink-500 rounded-full"></div>
            <span>Fully interactive 3D rooms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
            <span>Comments & feedback system</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DemoNetworkPage() {
  return (
    <Suspense fallback={null}>
      <DemoNetworkPageInner />
    </Suspense>
  )
}