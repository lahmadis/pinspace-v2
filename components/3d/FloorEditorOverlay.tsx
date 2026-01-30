'use client'

import { useState, useRef, useCallback } from 'react'
import { calculateFloorBounds, getWallTransform } from '@/lib/wallLayout'
import type { WallConfig } from '@/lib/wallLayout'
import type { FloorTable } from '@/types'
import { X, Plus, Upload, Save, Trash2 } from 'lucide-react'

const TABLE_HEIGHT_INCHES = 18 // 1.5 feet
const DEFAULT_TABLE_WIDTH = 24
const DEFAULT_TABLE_DEPTH = 18

interface FloorEditorOverlayProps {
  wallConfig: WallConfig
  tables: FloorTable[]
  setTables: (tables: FloorTable[] | ((prev: FloorTable[]) => FloorTable[])) => void
  onSaveAndExit: () => void
}

const VIEW_WIDTH = 700
const VIEW_HEIGHT = 500

function worldToScreen(
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): [number, number] {
  const { minX, maxX, minZ, maxZ } = bounds
  const floorWidth = maxX - minX
  const floorDepth = maxZ - minZ
  const padding = 40
  const w = VIEW_WIDTH - padding * 2
  const h = VIEW_HEIGHT - padding * 2
  const px = padding + ((x - minX) / floorWidth) * w
  const py = padding + ((maxZ - z) / floorDepth) * h // +Z forward = up on screen
  return [px, py]
}

export default function FloorEditorOverlay({
  wallConfig,
  tables,
  setTables,
  onSaveAndExit,
}: FloorEditorOverlayProps) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; z: number; startPx: number; startPy: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bounds = calculateFloorBounds(wallConfig)
  const { minX, maxX, minZ, maxZ, floorWidth, floorDepth } = bounds

  const handleAddTable = useCallback(() => {
    const id = `table-${Date.now()}`
    const newTable: FloorTable = {
      id,
      x: (minX + maxX) / 2 - DEFAULT_TABLE_WIDTH / 2,
      z: (minZ + maxZ) / 2 - DEFAULT_TABLE_DEPTH / 2,
      width: DEFAULT_TABLE_WIDTH,
      depth: DEFAULT_TABLE_DEPTH,
      rotation: 0,
    }
    setTables((prev) => [...prev, newTable])
    setSelectedTableId(id)
  }, [minX, maxX, minZ, maxZ, setTables])

  const handleRotateTable = useCallback(
    (tableId: string, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setTables((prev) =>
        prev.map((t) =>
          t.id === tableId
            ? { ...t, rotation: (t.rotation ?? 0) + Math.PI / 2 }
            : t
        )
      )
    },
    [setTables]
  )

  const handleTableFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !selectedTableId) return
      const isGlb = file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')
      if (!isGlb) {
        alert('Please select a .glb or .gltf file.')
        return
      }
      // Use data URL instead of blob URL so the URL stays valid when opening the model viewer
      // (blob URLs can fail with "Failed to fetch" in GLTFLoader)
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setTables((prev) =>
          prev.map((t) => (t.id === selectedTableId ? { ...t, modelUrl: dataUrl } : t))
        )
      }
      reader.readAsDataURL(file)
      e.target.value = ''
    },
    [selectedTableId, setTables]
  )

  const handlePointerDownOnTable = useCallback(
    (tableId: string, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setSelectedTableId(tableId)
      const table = tables.find((t) => t.id === tableId)
      if (!table) return
      setDraggingTableId(tableId)
      setDragStart({
        x: table.x,
        z: table.z,
        startPx: e.clientX,
        startPy: e.clientY,
      })
    },
    [tables]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingTableId || !dragStart) return
      const deltaPx = e.clientX - dragStart.startPx
      const deltaPy = e.clientY - dragStart.startPy
      // Approximate delta in world space (1px ~= small amount in inches)
      const scaleX = floorWidth / (VIEW_WIDTH - 80)
      const scaleZ = floorDepth / (VIEW_HEIGHT - 80)
      const newX = dragStart.x + deltaPx * scaleX
      const newZ = dragStart.z - deltaPy * scaleZ
      setTables((prev) =>
        prev.map((t) =>
          t.id === draggingTableId ? { ...t, x: newX, z: newZ } : t
        )
      )
      setDragStart((s) => (s ? { ...s, x: newX, z: newZ, startPx: e.clientX, startPy: e.clientY } : null))
    },
    [draggingTableId, dragStart, floorWidth, floorDepth, setTables]
  )

  const handlePointerUp = useCallback(() => {
    setDraggingTableId(null)
    setDragStart(null)
  }, [])

  // Wall outlines (top-down) for context
  const wallOutlines = wallConfig.walls.map((_, index) => {
    const transform = getWallTransform(wallConfig, index)
    const halfW = transform.width / 2
    const halfD = 3
    const cos = Math.cos(transform.rotationY)
    const sin = Math.sin(transform.rotationY)
    const corners = [
      [transform.x - halfW * cos + halfD * sin, transform.z - halfW * sin - halfD * cos],
      [transform.x + halfW * cos + halfD * sin, transform.z + halfW * sin - halfD * cos],
      [transform.x + halfW * cos - halfD * sin, transform.z + halfW * sin + halfD * cos],
      [transform.x - halfW * cos - halfD * sin, transform.z - halfW * sin + halfD * cos],
    ]
    const points = corners.map(([x, z]) => worldToScreen(x, z, bounds)).flat()
    return { points, key: index }
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
        style={{ width: VIEW_WIDTH + 48, maxHeight: '90vh' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Floor plan – place tables</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddTable}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add table
            </button>
            <button
              type="button"
              onClick={onSaveAndExit}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              Save & exit
            </button>
            <button
              type="button"
              onClick={onSaveAndExit}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-auto">
          <p className="text-sm text-gray-500 mb-4">
            Top-down view. Drag tables to move. Click a table then &quot;Add model&quot; to place a 3D model on it.
          </p>

          <div
            className="relative rounded-lg border-2 border-gray-300 bg-gray-50"
            style={{ width: VIEW_WIDTH, height: VIEW_HEIGHT }}
          >
            {/* Floor outline */}
            <div
              className="absolute border-2 border-gray-400 rounded"
              style={{
                left: 40,
                top: 40,
                width: VIEW_WIDTH - 80,
                height: VIEW_HEIGHT - 80,
              }}
            />

            {/* Wall outlines (top-down) */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              preserveAspectRatio="none"
            >
              {wallOutlines.map(({ points, key }) => (
                <polygon
                  key={key}
                  points={points.join(',')}
                  fill="rgba(183, 196, 255, 0.5)"
                  stroke="#B3B3FF"
                  strokeWidth={2}
                />
              ))}
            </svg>

            {/* Tables */}
            {tables.map((table) => {
              const [px, py] = worldToScreen(table.x, table.z, bounds)
              const scaleX = (VIEW_WIDTH - 80) / floorWidth
              const scaleZ = (VIEW_HEIGHT - 80) / floorDepth
              const w = table.width * scaleX
              const h = table.depth * scaleZ
              const isSelected = selectedTableId === table.id
              const rotationDeg = ((table.rotation ?? 0) * 180) / Math.PI
              return (
                <div
                  key={table.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => handlePointerDownOnTable(table.id, e)}
                  className="absolute cursor-move rounded-lg border-2 flex flex-col items-center justify-center overflow-visible group"
                  style={{
                    left: px - w / 2,
                    top: py - h / 2,
                    width: w,
                    height: h,
                    minWidth: 24,
                    minHeight: 18,
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: '50% 50%',
                    borderColor: isSelected ? '#6366f1' : '#94a3b8',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                  }}
                >
                  {table.modelUrl ? (
                    <span className="text-[10px] font-medium text-indigo-700 truncate px-1">Model</span>
                  ) : (
                    <span className="text-[10px] font-medium text-slate-600 truncate px-1">Table</span>
                  )}
                  {/* Invisible corner hit areas – hover corner and click to rotate 90° */}
                  {[['0%', '0%'], ['100%', '0%'], ['100%', '100%'], ['0%', '100%']].map(([left, top], i) => (
                    <div
                      key={i}
                      className="absolute w-6 h-6 cursor-pointer"
                      style={{ left, top, transform: 'translate(-50%, -50%)', margin: 0 }}
                      title="Rotate 90°"
                      onPointerDown={(e) => handleRotateTable(table.id, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ))}
                </div>
              )
            })}
          </div>

          {selectedTableId && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-700">Selected table</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf"
                className="hidden"
                onChange={handleTableFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium text-gray-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Add model
              </button>
              <button
                type="button"
                onClick={() => {
                  setTables((prev) => prev.filter((t) => t.id !== selectedTableId))
                  setSelectedTableId(null)
                }}
                className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Remove table
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { TABLE_HEIGHT_INCHES }
