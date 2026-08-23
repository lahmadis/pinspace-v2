'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getWallTransformResolved, calculateFloorBounds } from '@/lib/wallLayout'
import type { WallConfig } from '@/lib/wallLayout'
import { ChevronDown, ChevronUp } from 'lucide-react'

const CANVAS_W = 240
const CANVAS_H = 180

interface WallConfigPreviewProps {
  wallConfig: WallConfig
}

export function WallConfigPreview({ wallConfig }: WallConfigPreviewProps) {
  const [collapsed, setCollapsed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    roomGroup: THREE.Group
  } | null>(null)

  // Initialize renderer, scene, camera once on mount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(CANVAS_W, CANVAS_H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)

    const camera = new THREE.PerspectiveCamera(38, CANVAS_W / CANVAS_H, 1, 10000)

    const ambient = new THREE.AmbientLight(0xffffff, 0.65)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(300, 500, 400)
    scene.add(dir)

    const roomGroup = new THREE.Group()
    scene.add(roomGroup)

    threeRef.current = { renderer, scene, camera, roomGroup }

    return () => {
      roomGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
          else child.material.dispose()
        }
      })
      renderer.dispose()
      threeRef.current = null
    }
  }, [])

  // Rebuild geometry and render one frame on each wallConfig change
  useEffect(() => {
    if (collapsed) return
    const three = threeRef.current
    if (!three) return

    const { renderer, scene, camera, roomGroup } = three

    // Dispose previous meshes
    const old: THREE.Mesh[] = []
    roomGroup.traverse((child) => { if (child instanceof THREE.Mesh) old.push(child) })
    old.forEach((mesh) => {
      mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose())
      else mesh.material.dispose()
    })
    roomGroup.clear()

    // Walls — same color as main view (#D8DEFF), slightly muted
    wallConfig.walls.forEach((_, i) => {
      const t = getWallTransformResolved(wallConfig, i)
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(t.width, t.height, 6),
        new THREE.MeshStandardMaterial({ color: 0xd8deff, roughness: 0.85, metalness: 0 })
      )
      mesh.position.set(t.x, t.height / 2, t.z)
      mesh.rotation.y = t.rotationY
      roomGroup.add(mesh)
    })

    // Floor
    const bounds = calculateFloorBounds(wallConfig)
    const floorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(bounds.floorWidth, 6, bounds.floorDepth),
      new THREE.MeshStandardMaterial({ color: 0xc8ceef, roughness: 0.9, metalness: 0 })
    )
    floorMesh.position.set(bounds.floorCenterX, -3, bounds.floorCenterZ)
    roomGroup.add(floorMesh)

    // Fit camera: true isometric angle — 30° elevation, 45° azimuth
    const box = new THREE.Box3().setFromObject(roomGroup)
    if (!box.isEmpty()) {
      const sphere = new THREE.Sphere()
      box.getBoundingSphere(sphere)
      const { center, radius } = sphere
      const dist = radius * 2.5
      const elev = Math.PI / 6   // 30°
      const azi  = Math.PI / 4   // 45°
      camera.position.set(
        center.x + dist * Math.cos(elev) * Math.sin(azi),
        center.y + dist * Math.sin(elev),
        center.z + dist * Math.cos(elev) * Math.cos(azi)
      )
      camera.lookAt(center)
      camera.near = dist * 0.01
      camera.far  = dist * 10
      camera.updateProjectionMatrix()
    }

    renderer.render(scene, camera)
  }, [wallConfig, collapsed])

  return (
    <div
      className="absolute bottom-4 right-4 z-10 hidden md:flex flex-col rounded-xl overflow-hidden shadow-xl"
      style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.15)' }}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-medium text-white/70 tracking-wide">Preview</span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="p-0.5 rounded hover:bg-white/10 transition-colors"
          aria-label={collapsed ? 'Expand preview' : 'Collapse preview'}
        >
          {collapsed
            ? <ChevronDown className="w-3.5 h-3.5 text-white/60" />
            : <ChevronUp className="w-3.5 h-3.5 text-white/60" />
          }
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ display: collapsed ? 'none' : 'block' }}
      />
    </div>
  )
}
