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

function getEntry(url: string): Entry {
  let entry = cache.get(url)
  if (!entry) {
    const e = {} as Entry
    e.promise = new Promise<void>((resolve, reject) => {
      const loader = new STLLoader()
      loader.load(
        url,
        (geometry) => {
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
