'use client'

import { Suspense, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, useGLTF, Center } from '@react-three/drei'
import * as THREE from 'three'

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const cloned = scene.clone(true)
  return (
    <Center>
      <primitive object={cloned} />
    </Center>
  )
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
  return (
    <>
      <PerspectiveCamera makeDefault position={[40, 30, 40]} fov={50} />
      <CameraRig />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-10, 10, -10]} intensity={0.4} />
      <Suspense
        fallback={
          <mesh>
            <boxGeometry args={[2, 2, 2]} />
            <meshStandardMaterial color="#888" wireframe />
          </mesh>
        }
      >
        <Model url={url} />
      </Suspense>
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
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
