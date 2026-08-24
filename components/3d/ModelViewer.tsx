'use client'

/* eslint-disable react-hooks/immutability -- R3F camera framing must update the Three.js camera instance after model geometry resolves. */

import '@/components/3d/setupDraco'
import { Suspense, useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { useRhino3dm } from '@/components/3d/useRhino3dm'
import { SceneErrorBoundary } from '@/components/3d/SceneErrorBoundary'
import { useStlLoader } from '@/components/3d/useStlLoader'
import { fitToScene } from '@/lib/3d/fitToScene'
import { ENGINE_PALETTE } from './enginePalette'

function is3dm(url: string) { return url.toLowerCase().endsWith('.3dm') }
function isStl(url: string) { return url.toLowerCase().endsWith('.stl') }

function getControls(ref: React.RefObject<unknown>): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

/**
 * Frames the camera to fit the loaded model's bounding sphere.
 * Must render inside <Suspense> so it only mounts after the model geometry is available.
 * Re-frames when `url` changes (cached models re-load without suspend).
 */
function FrameCamera({
  objectRef,
  orbitControlsRef,
  url,
}: {
  objectRef: React.RefObject<THREE.Group | null>
  orbitControlsRef: React.RefObject<unknown>
  url: string
}) {
  const { camera } = useThree()

  useEffect(() => {
    const obj = objectRef.current
    if (!obj) return

    const box = new THREE.Box3().setFromObject(obj)
    const sphere = new THREE.Sphere()
    box.getBoundingSphere(sphere)
    const { center, radius } = sphere

    const controls = getControls(orbitControlsRef)

    if (radius < 0.001) {
      camera.position.set(3, 2, 3)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      if (controls) { controls.target.set(0, 0, 0); controls.update() }
      return
    }

    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180)
    const distance = radius / Math.sin(fov / 2)
    const paddingMultiplier = 0.4
    const offset = new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance * paddingMultiplier)
    camera.position.copy(center).add(offset)
    camera.lookAt(center)

    ;(camera as THREE.PerspectiveCamera).near = Math.max(0.001, distance - radius * 2)
    ;(camera as THREE.PerspectiveCamera).far = distance + radius * 4
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.copy(center)
      controls.minDistance = Math.max(0.001, radius * 0.5)
      controls.maxDistance = radius * 20
      controls.update()
    }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

type ModelProps = { url: string; orbitControlsRef: React.RefObject<unknown> }

function GlbModel({ url, orbitControlsRef }: ModelProps) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => scene.clone(true), [scene])
  const { scale, center } = useMemo(() => fitToScene(cloned), [cloned])
  const groupRef = useRef<THREE.Group>(null)
  return (
    <group ref={groupRef}>
      <primitive
        object={cloned}
        scale={scale}
        position={[-center.x * scale, -center.y * scale, -center.z * scale]}
      />
      <FrameCamera objectRef={groupRef} orbitControlsRef={orbitControlsRef} url={url} />
    </group>
  )
}

function RhinoModel({ url, orbitControlsRef }: ModelProps) {
  const { scene } = useRhino3dm(url)
  const cloned = useMemo(() => scene.clone(true), [scene])
  const groupRef = useRef<THREE.Group>(null)
  return (
    <group ref={groupRef}>
      <primitive object={cloned} />
      <FrameCamera objectRef={groupRef} orbitControlsRef={orbitControlsRef} url={url} />
    </group>
  )
}

function StlModel({ url, orbitControlsRef }: ModelProps) {
  const { scene } = useStlLoader(url)
  const cloned = useMemo(() => scene.clone(true), [scene])
  const groupRef = useRef<THREE.Group>(null)
  return (
    <group ref={groupRef}>
      <primitive object={cloned} />
      <FrameCamera objectRef={groupRef} orbitControlsRef={orbitControlsRef} url={url} />
    </group>
  )
}

function Model({ url, orbitControlsRef }: ModelProps) {
  if (is3dm(url)) return <RhinoModel url={url} orbitControlsRef={orbitControlsRef} />
  if (isStl(url)) return <StlModel url={url} orbitControlsRef={orbitControlsRef} />
  return <GlbModel url={url} orbitControlsRef={orbitControlsRef} />
}

/** Smooth orbit while dragging; stops instantly on mouse release (same as studio rooms). */
function CrispOrbitRestore({ orbitControlsRef }: { orbitControlsRef: React.RefObject<unknown> }) {
  const { camera } = useThree()
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())

  const listenerControlsRef = useRef<OrbitControlsType | null>(null)
  const endHandlerRef = useRef<(() => void) | null>(null)

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

function Scene({ url }: { url: string }) {
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)

  return (
    <>
      <PerspectiveCamera makeDefault position={[3, 2, 3]} fov={50} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-10, 10, -10]} intensity={0.4} />
      <Suspense
        fallback={
          <group>
            <mesh>
              <boxGeometry args={[2, 2, 2]} />
              <meshStandardMaterial color={ENGINE_PALETTE.modelWire} wireframe />
            </mesh>
            <Html center position={[0, 2, 0]} style={{ color: ENGINE_PALETTE.owned, fontSize: 14, fontFamily: 'system-ui', whiteSpace: 'nowrap' }}>
              Loading model...
            </Html>
          </group>
        }
      >
        <Model url={url} orbitControlsRef={orbitControlsRef} />
      </Suspense>
      <CrispOrbitRestore orbitControlsRef={orbitControlsRef} />
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping={true}
        dampingFactor={0.08}
        minDistance={0.01}
        maxDistance={10000}
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
      <div className="flex h-full w-full items-center justify-center bg-background-lighter p-4 text-center text-text-primary">
        <p>This model link is no longer valid. Add the model again from the floor editor (Place tables → select table → Add model).</p>
      </div>
    )
  }
  return (
    <div className="w-full h-full">
      <SceneErrorBoundary resetKey={modelUrl}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [3, 2, 3], fov: 50 }}
        style={{ background: ENGINE_PALETTE.wallMain }}
      >
        <Scene url={modelUrl} />
      </Canvas>
      </SceneErrorBoundary>
    </div>
  )
}
