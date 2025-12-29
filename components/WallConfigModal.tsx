'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, ChevronRight, ChevronDown } from 'lucide-react'

interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
}

const DEFAULT_ZIGZAG_WALLS: WallDimensions[] = [
  { height: 10, width: 8 },
  { height: 10, width: 8 },
  { height: 10, width: 8 },
  { height: 10, width: 8 }
]

interface WallConfigModalProps {
  onConfirm: (config: WallConfig) => void
  initialConfig?: WallConfig
}

export default function WallConfigModal({ onConfirm, initialConfig }: WallConfigModalProps) {
  const [useCustom, setUseCustom] = useState(false)
  const [numWalls, setNumWalls] = useState(initialConfig?.walls.length || 4)
  const [walls, setWalls] = useState<WallDimensions[]>(
    initialConfig?.walls || DEFAULT_ZIGZAG_WALLS
  )

  const handleCustomToggle = () => {
    setUseCustom(!useCustom)
  }

  const handleWallChange = (index: number, field: 'height' | 'width', value: string) => {
    const numValue = parseFloat(value) || 0
    const newWalls = [...walls]
    newWalls[index] = { ...newWalls[index], [field]: numValue }
    setWalls(newWalls)
  }

  const handleNumWallsChange = (value: string) => {
    const num = parseInt(value) || 1
    const clampedNum = Math.max(1, Math.min(8, num))
    setNumWalls(clampedNum)
    
    const newWalls = [...walls]
    while (newWalls.length < clampedNum) {
      newWalls.push({ height: 10, width: 8 })
    }
    while (newWalls.length > clampedNum) {
      newWalls.pop()
    }
    setWalls(newWalls)
    setUseCustom(true)
  }

  const handleConfirm = () => {
    const validWalls = walls.every(w => 
      w.height >= 5 && w.height <= 20 && 
      w.width >= 5 && w.width <= 20
    )
    
    if (!validWalls) {
      alert('All walls must be between 5ft and 20ft in both dimensions')
      return
    }
    
    onConfirm({ 
      walls: walls.slice(0, numWalls),
      layoutType: 'zigzag'
    })
  }

  const totalSquareFeet = walls.slice(0, numWalls).reduce((sum, w) => sum + (w.height * w.width), 0)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl border border-gray-200 shadow-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">Configure Studio Walls</h2>
          <p className="text-sm text-gray-500">Customize your wall dimensions</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Custom Configuration Toggle */}
          <div className="mb-6">
            <button
              onClick={handleCustomToggle}
              className="w-full p-4 rounded-xl border border-gray-200 transition-all bg-white hover:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-gray-900">Custom Configuration</div>
                    <div className="text-sm text-gray-500">Manually set wall dimensions</div>
                  </div>
                </div>
                <div className="text-gray-400">
                  {useCustom ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </div>
              </div>
            </button>
          </div>

          {/* Custom Configuration Panel */}
          {useCustom && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6"
            >
              <div className="bg-gray-50 rounded-xl p-6">
                {/* Number of walls */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Number of Walls
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={numWalls}
                    onChange={(e) => handleNumWallsChange(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 focus:outline-none bg-white text-lg font-semibold"
                  />
                </div>

                {/* Wall dimensions */}
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {walls.slice(0, numWalls).map((wall, index) => (
                    <div key={index} className="bg-white p-4 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold text-gray-900">Wall {index + 1}</span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                          {(wall.height * wall.width).toFixed(0)} sq ft
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Height (ft)
                          </label>
                          <input
                            type="number"
                            min="5"
                            max="20"
                            step="0.5"
                            value={wall.height}
                            onChange={(e) => handleWallChange(index, 'height', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 focus:outline-none bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Width (ft)
                          </label>
                          <input
                            type="number"
                            min="5"
                            max="20"
                            step="0.5"
                            value={wall.width}
                            onChange={(e) => handleWallChange(index, 'width', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 focus:outline-none bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Stats */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Walls:</span>
                <span className="text-lg font-semibold text-indigo-600">{numWalls}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Wall Space:</span>
                <span className="text-lg font-semibold text-indigo-600">{totalSquareFeet.toFixed(0)} sq ft</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Layout:</span>
                <span className="text-lg font-semibold text-indigo-600 capitalize">Zigzag</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-6 bg-white">
          <button
            onClick={handleConfirm}
            className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-semibold text-sm shadow-sm"
          >
            Continue to Studio →
          </button>
        </div>
      </motion.div>
    </div>
  )
}