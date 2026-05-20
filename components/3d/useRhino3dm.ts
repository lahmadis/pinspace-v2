'use client'

import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js'
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
      const loader = new Rhino3dmLoader()
      loader.setLibraryPath('/wasm/')
      loader.load(
        url,
        (object) => { e.result = object; resolve() },
        undefined,
        (err: unknown) => { e.error = err ?? new Error('Rhino3dm load failed'); reject(e.error) }
      )
    })
    cache.set(url, e)
    entry = e
  }
  return entry
}

export function useRhino3dm(url: string): { scene: Object3D } {
  const entry = getEntry(url)
  if (entry.error) throw entry.error
  if (!entry.result) throw entry.promise
  return { scene: entry.result }
}
