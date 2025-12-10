'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
}

interface LayoutTemplate {
  id: LayoutType
  name: string
  description: string
  icon: string
  config: WallConfig
}

const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: 'zigzag',
    name: 'Zig-Zag',
    description: 'Alternating angled walls',
    icon: '⚡',
    config: {
      layoutType: 'zigzag',
      walls: [
        { height: 10, width: 8 },
        { height: 10, width: 8 },
        { height: 10, width: 8 },
        { height: 10, width: 8 }
      ]
    }
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Enclosed square room',
    icon: '⬜',
    config: {
      layoutType: 'square',
      walls: [
        { height: 10, width: 10 },
        { height: 10, width: 10 },
        { height: 10, width: 10 },
        { height: 10, width: 10 }
      ]
    }
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Parallel walls in a row',
    icon: '║',
    config: {
      layoutType: 'linear',
      walls: [
        { height: 10, width: 8 },
        { height: 10, width: 8 },
        { height: 10, width: 8 }
      ]
    }
  },
  {
    id: 'lshape',
    name: 'L-Shape',
    description: 'Corner L-shaped layout',
    icon: '⌐',
    config: {
      layoutType: 'lshape',
      walls: [
        { height: 10, width: 10 },
        { height: 10, width: 8 },
        { height: 10, width: 8 }
      ]
    }
  }
]

interface WallConfigModalProps {
  onConfirm: (config: WallConfig) => void
  initialConfig?: WallConfig
}

export default function WallConfigModal({ onConfirm, initialConfig }: WallConfigModalProps) {
  const [selectedLayout, setSelectedLayout] = useState<LayoutType>(initialConfig?.layoutType || 'zigzag')
  const [useCustom, setUseCustom] = useState(false)
  const [numWalls, setNumWalls] = useState(initialConfig?.walls.length || 4)
  const [walls, setWalls] = useState<WallDimensions[]>(
    initialConfig?.walls || LAYOUT_TEMPLATES[0].config.walls
  )

  const handleLayoutSelect = (template: LayoutTemplate) => {
    setSelectedLayout(template.id)
    setWalls(JSON.parse(JSON.stringify(template.config.walls)))
    setNumWalls(template.config.walls.length)
    setUseCustom(false)
  }

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
      layoutType: useCustom ? 'zigzag' : selectedLayout
    })
  }

  const totalSquareFeet = walls.slice(0, numWalls).reduce((sum, w) => sum + (w.height * w.width), 0)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary-dark p-6 text-white">
          <h2 className="text-3xl font-bold mb-2">Configure Studio Walls</h2>
          <p className="text-white/90">Choose a layout template or customize your own</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Layout Templates */}
          <div className="mb-8">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Choose a Layout Template</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {LAYOUT_TEMPLATES.map((template) => (
                <motion.button
                  key={template.id}
                  onClick={() => handleLayoutSelect(template)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedLayout === template.id && !useCustom
                      ? 'border-primary bg-primary/5 shadow-lg'
                      : 'border-gray-200 hover:border-primary/50 hover:shadow-md'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="text-4xl mb-2">{template.icon}</div>
                  <div className="font-bold text-gray-800 mb-1">{template.name}</div>
                  <div className="text-sm text-gray-600 mb-2">{template.description}</div>
                  <div className="text-xs text-gray-500">
                    {template.config.walls.length} walls • {template.config.walls.reduce((sum, w) => sum + w.height * w.width, 0)} sq ft
                  </div>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Custom Configuration Toggle */}
          <div className="mb-6">
            <button
              onClick={handleCustomToggle}
              className={`w-full p-4 rounded-xl border-2 transition-all ${
                useCustom
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <div className="font-bold text-gray-800">🎨 Custom Configuration</div>
                  <div className="text-sm text-gray-600">Manually set wall dimensions</div>
                </div>
                <div className="text-2xl">{useCustom ? '▼' : '▶'}</div>
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
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-primary focus:outline-none text-lg font-semibold"
                  />
                </div>

                {/* Wall dimensions */}
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {walls.slice(0, numWalls).map((wall, index) => (
                    <div key={index} className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold text-gray-700">Wall {index + 1}</span>
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-primary focus:outline-none"
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-primary focus:outline-none"
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
          <div className="bg-gray-50 rounded-xl p-6">
            <div className="bg-white rounded-lg p-4 space-y-2 border-2 border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600">Total Walls:</span>
                <span className="text-lg font-bold text-primary">{numWalls}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600">Total Wall Space:</span>
                <span className="text-lg font-bold text-primary">{totalSquareFeet.toFixed(0)} sq ft</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600">Layout:</span>
                <span className="text-lg font-bold text-primary capitalize">{useCustom ? 'Custom' : selectedLayout}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <button
            onClick={handleConfirm}
            className="w-full px-8 py-4 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors font-semibold shadow-lg hover:shadow-xl text-lg"
          >
            Continue to Studio →
          </button>
        </div>
      </motion.div>
    </div>
  )
}