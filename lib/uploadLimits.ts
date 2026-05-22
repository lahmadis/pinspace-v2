export const MAX_MODEL_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const SUPPORTED_MODEL_EXTENSIONS = ['.glb', '.gltf', '.3dm', '.stl'] as const
export type SupportedModelExt = typeof SUPPORTED_MODEL_EXTENSIONS[number]
