import * as THREE from 'three'

export function fitToScene(
  object: THREE.Object3D,
  targetSize = 1.5
): { scale: number; center: THREE.Vector3 } {
  const bbox = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  bbox.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = maxDim > 0 ? targetSize / maxDim : 1
  const center = new THREE.Vector3()
  bbox.getCenter(center)
  return { scale, center }
}
