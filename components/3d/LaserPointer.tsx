import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { LaserState } from './CameraController'

/**
 * Presenter cursor/laser dot, rendered for FOLLOWERS (the presenter's own
 * laserRef stays null — self:false on the channel). Reads the latest pose ref in
 * useFrame and smooth-lerps a bright dot toward it. raycast=null so it never
 * intercepts clicks (followers can still click boards / open the lightbox).
 * depthTest off + high renderOrder keep it visible without z-fighting. Hidden on
 * { off } (null ref) or after ~2s with no new packet (seq unchanged), e.g. a
 * presenter drop. Shared by the member studio (StudioRoom) and guest crit pages
 * so the dot renders identically for both. No state, no logging.
 */
export function LaserPointer({
  laserRef,
  color,
}: {
  laserRef?: React.MutableRefObject<LaserState | null>
  color: string
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const lastSeq = useRef(-1)
  const idleSeconds = useRef(0)
  const target = useRef(new THREE.Vector3())
  const hasTarget = useRef(false)
  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const data = laserRef?.current
    if (!data) {
      mesh.visible = false
      hasTarget.current = false
      return
    }
    if (data.seq !== lastSeq.current) {
      lastSeq.current = data.seq
      idleSeconds.current = 0
      target.current.set(data.p[0], data.p[1], data.p[2])
      hasTarget.current = true
    } else {
      idleSeconds.current += delta
    }
    if (!hasTarget.current || idleSeconds.current > 2) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    const alpha = 1 - Math.exp(-delta * 18)
    mesh.position.lerp(target.current, alpha)
  })
  return (
    <mesh ref={meshRef} visible={false} renderOrder={999} raycast={() => null}>
      <sphereGeometry args={[1.8, 16, 16]} />
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} depthTest={false} />
    </mesh>
  )
}
