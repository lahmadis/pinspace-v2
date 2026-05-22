'use client'

import '@/components/3d/setupDraco'
import { Suspense, useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { useRhino3dm } from '@/components/3d/useRhino3dm'
import { useStlLoader } from '@/components/3d/useStlLoader'
import { fitToScene } from '@/lib/3d/fitToScene'

function is3dm(url: string) { return url.toLowerCase().endsWith('.3dm') }
function isStl(url: string) { return url.toLowerCase().endsWith('.stl') }

function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => scene.clone(true), [scene])
  const { scale, center } = useMemo(() => fitToScene(cloned), [cloned])
  return (
    <primitive
      object={cloned}
      scale={scale}
      position={[-center.x * scale, -center.y * scale, -center.z * scale]}
    />
  )
}

function RhinoModel({ url }: { url: string }) {
  const { scene } = useRhino3dm(url)
  const cloned = useMemo(() => scene.clone(true), [scene])
  return <primitive object={cloned} />
}

function StlModel({ url }: { url: string }) {
  const { scene } = useStlLoader(url)
  const cloned = useMemo(() => scene.clone(true), [scene])
  return <primitive object={cloned} />
}

function Model({ url }: { url: string }) {
  if (is3dm(url)) return <RhinoModel url={url} />
  if (isStl(url)) return <StlModel url={url} />
  return <GlbModel url={url} />
}

function getControls(ref: React.RefObject<unknown>): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

/** Smooth orbit while dragging; stops instantly on mouse release (same as studio rooms). */
function CrispOrbitRestore({ orbitControlsRef }: { orbitControlsRef: React.RefObject<unknown> }) {
  const { camera } = useThree()
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())

  // Track controls instance to register/remove listener when it changes
  const listenerControlsRef = useRef<OrbitControlsType | null>(null)
  const endHandlerRef = useRef<(() => void) | null>(null)

  // Remove listener on unmount
  useEffect(() => {
    return () => {
      if (listenerControlsRef.current && endHandlerRef.current) {
        listenerControlsRef.current.removeEventListener('end', endHandlerRef.current)
      }
    }
  }, [])

  useFrame(() => {
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    // Re-register listener if controls instance changed
    if (listenerControlsRef.current !== controls) {
      if (listenerControlsRef.current && endHandlerRef.current) {
        listenerControlsRef.current.removeEventListener('end', endHandlerRef.current)
      }
      endHandlerRef.current = () => {
        positionOnEnd.current.copy(camera.position)
        targetOnEnd.current.copy(controls.target)
        restoreOnNextFrame.current = true
      }
      controls.addEventListener('end', endHandlerRef.current)
      listenerControlsRef.current = controls
    }

    controls.update()

    if (restoreOnNextFrame.current) {
      camera.position.copy(positionOnEnd.current)
      controls.target.copy(targetOnEnd.current)
      restoreOnNextFrame.current = false
    }
  })

  return null
}

function CameraRig() {
  const { camera } = useThree()
  const initial = useRef(false)
  if (!initial.current) {
    initial.current = true
    camera.position.set(40, 30, 40)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }
  return null
}

function Scene({ url }: { url: string }) {
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)

  return (
    <>
      <PerspectiveCamera makeDefault position={[40, 30, 40]} fov={50} />
      <CameraRig />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-10, 10, -10]} intensity={0.4} />
      <Suspense
        fallback={
          <group>
            <mesh>
              <boxGeometry args={[2, 2, 2]} />
              <meshStandardMaterial color="#888" wireframe />
            </mesh>
            <Html center position={[0, 2, 0]} style={{ color: '#333', fontSize: 14, fontFamily: 'system-ui', whiteSpace: 'nowrap' }}>
              Loading model...
            </Html>
          </group>
        }
      >
        <Model url={url} />
      </Suspense>
      <CrispOrbitRestore orbitControlsRef={orbitControlsRef} />
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping={true}
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={500}
        maxPolarAngle={Math.PI / 2}
      />
    </>
  )
}

interface ModelViewerProps {
  modelUrl: string
}

export default function ModelViewer({ modelUrl }: ModelViewerProps) {
  useEffect(() => {
    if (modelUrl && !modelUrl.startsWith('blob:') && !is3dm(modelUrl) && !isStl(modelUrl)) useGLTF.preload(modelUrl)
  }, [modelUrl])

  if (!modelUrl || modelUrl.startsWith('blob:')) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#D8DEFF] text-gray-700 p-4 text-center">
        <p>This model link is no longer valid. Add the model again from the floor editor (Place tables → select table → Add model).</p>
      </div>
    )
  }
  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        gl={{ antialias: true }}
        camera={{ position: [40, 30, 40], fov: 50 }}
        style={{ background: '#D8DEFF' }}
      >
        <Scene url={modelUrl} />
      </Canvas>
    </div>
  )
}
