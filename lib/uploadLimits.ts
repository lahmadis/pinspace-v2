export const MAX_IMAGE_SIZE_BYTES = 75 * 1024 * 1024 // 75 MB (matches board-images bucket cap)
export const MAX_MODEL_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB (.glb/.gltf/.3dm)
// STL — especially ASCII STL — is far more verbose than binary formats, so it
// gets a larger cap. Kept under the 75 MB board-images bucket limit.
export const MAX_STL_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

export const SUPPORTED_MODEL_EXTENSIONS = ['.glb', '.gltf', '.3dm', '.stl'] as const
export type SupportedModelExt = typeof SUPPORTED_MODEL_EXTENSIONS[number]

/** Per-format upload cap for a model file, keyed by extension. */
export function maxModelBytesForName(fileName: string): number {
  return fileName.toLowerCase().endsWith('.stl') ? MAX_STL_SIZE_BYTES : MAX_MODEL_SIZE_BYTES
}
