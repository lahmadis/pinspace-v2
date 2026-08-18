import { useEffect, useMemo, type DependencyList } from 'react'
import type { BufferGeometry } from 'three'

/**
 * Memoize a source BufferGeometry keyed on its dimensions and dispose the
 * previous instance when those dimensions change (and on unmount).
 *
 * Constructing `new THREE.BoxGeometry(...)` / `new THREE.PlaneGeometry(...)`
 * inline inside an `<edgesGeometry args={[...]}>` leaks the source geometry:
 * R3F owns and disposes the EdgesGeometry it builds, but never the intermediate
 * source passed as a constructor arg. That leak accrues once per pointer-move
 * while a board is resized (its dimensions change every frame). This hook keeps
 * the source stable across re-renders and frees the old GPU buffers whenever the
 * dimensions actually change.
 */
export function useDisposableGeometry<T extends BufferGeometry>(
  factory: () => T,
  deps: DependencyList,
): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(factory, deps)
  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])
  return geometry
}
