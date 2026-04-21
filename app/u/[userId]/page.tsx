'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

type PortfolioBoard = {
  id: string
  title: string
  thumbnailUrl: string
  fullImageUrl: string
  uploadedAt: string
  tags: string[]
  studioId: string
  studioName: string
  networkMetadata?: { year?: string; department?: string }
  academicYear?: string
  aspectRatio?: number
}

type Profile = {
  full_name: string | null
  major: string | null
  year: string | null
  role: string | null
}

export default function PortfolioPage() {
  const params = useParams()
  const userId = params.userId as string

  const [boards, setBoards] = useState<PortfolioBoard[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedBoard, setSelectedBoard] = useState<PortfolioBoard | null>(null)
  const [filterStudio, setFilterStudio] = useState<string>('all')

  useEffect(() => {
    fetch(`/api/users/${userId}/boards`)
      .then((r) => r.json())
      .then((data) => {
        setBoards(data.boards || [])
        setProfile(data.profile || null)
        setOwnerName(data.ownerName || null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [userId])

  const displayName = profile?.full_name || ownerName || 'Student'

  const uniqueStudios = Array.from(
    new Map(boards.map((b) => [b.studioId, b.studioName])).entries()
  )

  const filtered = filterStudio === 'all' ? boards : boards.filter((b) => b.studioId === filterStudio)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/explore" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
            ← PinSpace
          </Link>
          <span className="text-xs text-gray-400">Student Portfolio</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Profile hero */}
        <div className="mb-10">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600 mb-4">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{displayName}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {profile?.year && (
              <span className="text-sm text-gray-500">{profile.year}</span>
            )}
            {profile?.major && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-sm text-gray-500">{profile.major}</span>
              </>
            )}
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">{boards.length} board{boards.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {boards.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg font-medium">No public boards yet</p>
            <p className="text-sm mt-1">Boards from published studios will appear here.</p>
          </div>
        ) : (
          <>
            {/* Studio filter */}
            {uniqueStudios.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap mb-8">
                <button
                  onClick={() => setFilterStudio('all')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    filterStudio === 'all'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  All Studios
                </button>
                {uniqueStudios.map(([id, name]) => (
                  <button
                    key={id}
                    onClick={() => setFilterStudio(id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      filterStudio === id
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            {/* Board grid */}
            <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
              {filtered.map((board) => (
                <div
                  key={board.id}
                  className="break-inside-avoid cursor-pointer group"
                  onClick={() => setSelectedBoard(board)}
                >
                  <div className="overflow-hidden rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="relative w-full overflow-hidden bg-gray-100">
                      <Image
                        src={board.thumbnailUrl}
                        alt={board.title}
                        width={600}
                        height={board.aspectRatio ? Math.round(600 / board.aspectRatio) : 400}
                        className="w-full h-auto object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        unoptimized
                      />
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium text-gray-900 truncate">{board.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{board.studioName}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Lightbox */}
      {selectedBoard && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelectedBoard(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelectedBoard(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm"
            >
              Close ✕
            </button>
            <Image
              src={selectedBoard.fullImageUrl}
              alt={selectedBoard.title}
              width={1200}
              height={800}
              className="w-full h-auto rounded-xl object-contain max-h-[80vh]"
              unoptimized
            />
            <div className="mt-3 text-white">
              <p className="font-semibold">{selectedBoard.title}</p>
              <p className="text-sm text-white/60 mt-0.5">
                {selectedBoard.studioName}
                {selectedBoard.networkMetadata?.year && ` · ${selectedBoard.networkMetadata.year}`}
                {selectedBoard.academicYear && ` · ${selectedBoard.academicYear}`}
              </p>
              <Link
                href={`/studio/${selectedBoard.studioId}/view`}
                className="inline-block mt-3 text-xs px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                View studio →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
