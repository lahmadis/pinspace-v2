'use client'

import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import * as THREE from 'three'
import { fitToScene } from '@/lib/3d/fitToScene'
import type { Object3D } from 'three'

type Entry = {
  promise: Promise<void>
  result?: Object3D
  error?: unknown
}

const cache = new Map<string, Entry>()

/**
 * Does this geometry have normals a lighting pass can actually use?
 *
 * STL stores a normal per facet, but CAD exporters routinely write all-zero or
 * NaN normals, and some write none at all. Three.js does not warn — the mesh
 * just renders flat and unlit, which looks like a broken model rather than a
 * broken file. An all-zero attribute is therefore treated as absent.
 *
 * The scan exits on the first usable component, so the common case (good
 * normals) costs one iteration; only a genuinely degenerate attribute walks the
 * whole array, and that is exactly the case that needs recomputing anyway.
 */
function hasUsableNormals(geometry: THREE.BufferGeometry): boolean {
  const normal = geometry.getAttribute('normal')
  if (!normal || normal.count === 0) return false
  const values = normal.array as ArrayLike<number>
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== 0 && Number.isFinite(v)) return true
  }
  return false
}

function getEntry(url: string): Entry {
  let entry = cache.get(url)
  if (!entry) {
    const e = {} as Entry
    e.promise = new Promise<void>((resolve, reject) => {
      const loader = new STLLoader()
      loader.load(
        url,
        (geometry) => {
          // Derive normals when the file's are missing or degenerate. Cheap,
          // and a no-op for the majority of files that ship usable ones.
          if (!hasUsableNormals(geometry)) geometry.computeVertexNormals()
          const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.7 })
          const mesh = new THREE.Mesh(geometry, material)
          const { scale, center } = fitToScene(mesh)
          mesh.scale.setScalar(scale)
          mesh.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
          const group = new THREE.Group()
          group.add(mesh)
          e.result = group
          resolve()
        },
        undefined,
        (err: unknown) => { e.error = err ?? new Error('STL load failed'); reject(e.error) }
      )
    })
    cache.set(url, e)
    entry = e
  }
  return entry
}

export function useStlLoader(url: string): { scene: Object3D } {
  const entry = getEntry(url)
  if (entry.error) throw entry.error
  if (!entry.result) throw entry.promise
  return { scene: entry.result }
}
