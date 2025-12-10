'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Upload } from 'lucide-react'
import Image from 'next/image'
import type { Board } from '@/types'

interface EditModeOverlayProps {
  isVisible: boolean
  wallIndex: number
  availableBoards: Board[]
  wallDimensions: { width: number; height: number } | null
  onClose: () => void
  onUpload: () => void
  onBoardSelect: (board: Board) => void
  onBoardDragStart: (board: Board) => void
}

export function EditModeOverlay({
  isVisible,
  wallIndex,
  availableBoards,
  wallDimensions,
  onClose,
  onUpload,
  onBoardSelect,
  onBoardDragStart
}: EditModeOverlayProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Header */}
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between"
          >
            <div>
              <h2 className="text-xl font-semibold">Edit Wall {wallIndex + 1}</h2>
              <p className="text-sm text-gray-600">Drag and drop boards to arrange them on the wall</p>
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Save & Exit
            </button>
          </motion.div>

          {/* Sidebar - Always show for upload button */}
          <motion.div
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="fixed left-0 top-20 bottom-0 w-80 bg-white border-r border-gray-200 z-50 overflow-y-auto"
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Available Boards</h3>
              
              <button
                onClick={onUpload}
                className="w-full mb-6 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <Upload size={20} />
                Add Your Board
              </button>

              <div className="text-xs text-gray-500 mb-4 text-center">
                You can only move and delete your own boards
              </div>

              {availableBoards.length > 0 ? (
                <>
                  <div className="text-sm text-gray-600 mb-4">
                    {availableBoards.length} boards available
                  </div>

                  <div className="space-y-3">
                {availableBoards.map((board) => (
                  <button
                    key={board.id}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer?.setData('text/plain', board.id)
                      onBoardDragStart(board)
                    }}
                    onClick={() => onBoardSelect(board)}
                    className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-3 text-left cursor-grab active:cursor-grabbing"
                  >
                    {board.thumbnailUrl ? (
                      <div className="relative w-16 h-16 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
                        {board.thumbnailUrl.endsWith('.pdf') ? (
                          <div className="w-full h-full flex items-center justify-center bg-red-100">
                            <span className="text-xs text-red-600 font-bold">PDF</span>
                          </div>
                        ) : (
                          <Image
                            src={board.thumbnailUrl}
                            alt={board.title}
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="w-16 h-16 flex-shrink-0 bg-gray-300 rounded flex items-center justify-center">
                        <span className="text-gray-500 text-xs">No image</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{board.title}</div>
                      <div className="text-xs text-gray-500">Uploaded Board</div>
                    </div>
                  </button>
                ))}
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <p className="text-sm">No boards available</p>
                  <p className="text-xs mt-2">Upload files or place boards from other walls</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}