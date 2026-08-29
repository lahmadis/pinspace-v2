'use client'

/* eslint-disable react-hooks/immutability -- R3F camera framing must update the Three.js camera instance after model geometry resolves. */

import '@/components/3d/setupDraco'
import { Suspense, useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls, PerspectiveCamera, useGLTF, Html } from '@react-three/drei'
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

/**
 * Clone a loaded scene and flatten it to one matte tone.
 *
 * Same treatment TableWithModel gives models in the room, and for the same two
 * reasons. Uploaded files arrive in whatever colours their author gave them, so
 * a viewer that honoured them would show a different-looking object per upload.
 * And glTF defaults `metallicFactor` to 1.0 — a fully metallic surface with no
 * environment map reflects nothing and renders near-black — so metalness has to
 * be forced off or some models simply arrive as silhouettes.
 */
function useFlatClone(scene: THREE.Object3D) {
  const clone = useMemo(() => {
    const cloned = scene.clone(true)
    const color = new THREE.Color(ENGINE_PALETTE.viewerSurface)
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      // Own materials before touching them. clone() shares the source's, and
      // the source is useGLTF's global cache — painting these white in place
      // repainted the same model sitting on its plinth in the room behind this
      // overlay, and it stayed white after the viewer closed.
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach((raw) => {
        const m = raw as THREE.MeshStandardMaterial
        if (m.color) m.color.copy(color)
        if (m.map) m.map = null
        if (m.metalnessMap) m.metalnessMap = null
        if (m.roughnessMap) m.roughnessMap = null
        if (m.metalness !== undefined) m.metalness = 0
        if (m.roughness !== undefined) m.roughness = 0.85
        // NO emissive. It was added to lift a grey model off a blue
        // backdrop; on white-on-white the shading IS the read, and self-light
        // is the one thing that would flatten it.
        if (m.emissive) m.emissive.setRGB(0, 0, 0)
      })
    })
    return cloned
  }, [scene])

  /*
   * Free the cloned materials when this viewer closes.
   *
   * Cloning them (above) is what stopped this overlay repainting the model in
   * the room, but a clone nobody frees is a GPU allocation per open — and this
   * is a dialog people open, close and reopen.
   *
   * MATERIALS ONLY, never geometry: Object3D.clone() shares geometry with
   * useGLTF's cache exactly the way it shared materials, so disposing it here
   * would free buffers the next mount is still handed. Same rule as
   * TableWithModel's cleanup.
   */
  useEffect(() => {
    return () => {
      clone.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh || !mesh.material) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => (m as THREE.Material)?.dispose())
      })
    }
  }, [clone])

  return clone
}

function GlbModel({ url, orbitControlsRef }: ModelProps) {
  const { scene } = useGLTF(url)
  const cloned = useFlatClone(scene)
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
  const cloned = useFlatClone(scene)
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
  const cloned = useFlatClone(scene)
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

/**
 * The soft shadow the model sits on.
 *
 * Measured, not hardcoded. Only the .glb path runs through fitToScene — .3dm
 * and .stl arrive at whatever size and origin their author saved them at — so
 * there is no shared floor height to place this at. It watches the model group
 * until its bounding box stops changing (loading is async, and a Suspense
 * fallback has its own box), then pins itself to the underside and sizes itself
 * to the footprint.
 */
function GroundShadow({ targetRef }: { targetRef: React.RefObject<THREE.Group | null> }) {
  const [placement, setPlacement] = useState<{ y: number; scale: number } | null>(null)
  const settledFrames = useRef(0)
  const lastY = useRef<number | null>(null)

  useFrame(() => {
    const target = targetRef.current
    if (!target) return
    const box = new THREE.Box3().setFromObject(target)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const y = box.min.y
    // Two consecutive frames at the same height before committing: the first
    // box after a model resolves is often still mid-layout.
    if (lastY.current !== null && Math.abs(lastY.current - y) < 1e-4) {
      settledFrames.current += 1
    } else {
      settledFrames.current = 0
    }
    lastY.current = y
    if (settledFrames.current < 2) return
    const footprint = Math.max(size.x, size.z, 1e-3)
    const next = { y, scale: footprint * 4 }
    setPlacement((prev) =>
      prev && Math.abs(prev.y - next.y) < 1e-4 && Math.abs(prev.scale - next.scale) < 1e-4
        ? prev
        : next
    )
  })

  if (!placement) return null
  return (
    <ContactShadows
      position={[0, placement.y, 0]}
      scale={placement.scale}
      // Tied to the model's own size so the falloff looks the same whether the
      // file was authored in millimetres or feet.
      far={placement.scale * 0.35}
      blur={2.6}
      opacity={0.42}
      resolution={1024}
      color={ENGINE_PALETTE.viewerShadow}
    />
  )
}

function Scene({ url }: { url: string }) {
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)
  const modelRef = useRef<THREE.Group>(null)

  return (
    <>
      <PerspectiveCamera makeDefault position={[3, 2, 3]} fov={50} />
      {/*
        A softbox, not a key/fill rig.

        Ambient carries most of the budget (2.6 of ~3.9, so ~0.83 on a face
        after three.js's physically-correct falloff) and the directionals only
        tilt it. That is what makes an unlit side of a white object read as
        light grey instead of dark grey — the reference has no face darker than
        about 80%, and a conventional key/fill drops the away side far below
        that. The top face clears 1.0 and clips to white, which is exactly the
        product-shot look.

        No castShadow on the key: the shadow under the model is drawn by
        ContactShadows below, and a shadow map here would be a second, harder
        one on top of it.
      */}
      <ambientLight intensity={2.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.9} />
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
        <group ref={modelRef}>
          <Model url={url} orbitControlsRef={orbitControlsRef} />
        </group>
      </Suspense>
      <GroundShadow targetRef={modelRef} />
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
        style={{ background: ENGINE_PALETTE.viewerBackdrop }}
      >
        <Scene url={modelUrl} />
      </Canvas>
      </SceneErrorBoundary>
    </div>
  )
}
