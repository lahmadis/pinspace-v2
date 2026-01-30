/**
 * Shared wall layout math for 3D room and 2D floor editor.
 * 1 unit = 1 inch.
 */

export interface WallDimensions {
  height: number
  width: number
}

export type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

export interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
}

const SCALE = 12 // feet to inches

export function getWallTransform(
  wallConfig: WallConfig,
  index: number
): { x: number; z: number; rotationY: number; width: number; height: number } {
  const wall = wallConfig.walls[index]
  const width = wall.width * SCALE
  const height = wall.height * SCALE

  let x = 0
  let z = 0
  let rotationY = 0

  const { layoutType } = wallConfig

  switch (layoutType) {
    case 'zigzag': {
      const WALL_DEPTH = 6
      const OVERLAP = WALL_DEPTH / 2

      let currentX = 0
      let currentZ = 0

      for (let i = 0; i < index; i++) {
        const prevWidth = wallConfig.walls[i].width * SCALE
        if (i % 2 === 0) {
          currentX += prevWidth - (i > 0 ? OVERLAP : 0)
        } else {
          currentZ += prevWidth - OVERLAP
        }
      }

      if (index % 2 === 0) {
        x = currentX + width / 2 - (index > 0 ? OVERLAP / 2 : 0)
        z = currentZ
        rotationY = 0
      } else {
        x = currentX
        z = currentZ + width / 2 - OVERLAP / 2
        rotationY = Math.PI / 2
      }

      let totalXExtent = 0
      let totalZExtent = 0
      let tempX = 0
      let tempZ = 0
      for (let i = 0; i < wallConfig.walls.length; i++) {
        const w = wallConfig.walls[i].width * SCALE
        if (i % 2 === 0) {
          tempX += w - (i > 0 ? OVERLAP : 0)
          totalXExtent = Math.max(totalXExtent, tempX)
        } else {
          tempZ += w - OVERLAP
          totalZExtent = Math.max(totalZExtent, tempZ)
        }
      }
      x -= totalXExtent / 2
      z -= totalZExtent / 2
      break
    }

    case 'linear': {
      const spacing = width + 2
      x = index * spacing - (wallConfig.walls.length * spacing) / 2
      z = 0
      rotationY = 0
      break
    }

    case 'square': {
      const wallWidths = wallConfig.walls.map((w) => w.width * SCALE)
      if (index === 0) {
        x = 0
        z = wallWidths[0] / 2
        rotationY = 0
      } else if (index === 1) {
        x = wallWidths[0] / 2
        z = 0
        rotationY = Math.PI / 2
      } else if (index === 2) {
        x = 0
        z = -wallWidths[2] / 2
        rotationY = Math.PI
      } else if (index === 3) {
        x = -wallWidths[0] / 2
        z = 0
        rotationY = -Math.PI / 2
      }
      break
    }

    case 'lshape': {
      const wallWidths = wallConfig.walls.map((w) => w.width * SCALE)
      if (index === 0) {
        x = 0
        z = 0
        rotationY = 0
      } else if (index === 1) {
        x = wallWidths[0] / 2
        z = -wallWidths[1] / 2
        rotationY = Math.PI / 2
      } else if (index >= 2) {
        const prevWall = wallWidths[1]
        x = wallWidths[0] / 2
        z = -prevWall - (index - 1) * wallWidths[index]
        rotationY = Math.PI / 2
      }
      break
    }

    default: {
      const angle = (index * Math.PI) / 2
      const radius = 5 + (index - 4) * 2
      x = Math.cos(angle) * radius
      z = Math.sin(angle) * radius
      rotationY = angle + Math.PI / 2
    }
  }

  return { x, z, rotationY, width, height }
}

export function calculateFloorBounds(wallConfig: WallConfig): {
  floorWidth: number
  floorDepth: number
  floorCenterX: number
  floorCenterZ: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  const wallDepth = 6

  wallConfig.walls.forEach((_, index) => {
    const transform = getWallTransform(wallConfig, index)
    const halfWidth = transform.width / 2
    const halfDepth = wallDepth / 2

    const cos = Math.cos(transform.rotationY)
    const sin = Math.sin(transform.rotationY)

    const corners = [
      { x: -halfWidth, z: -halfDepth },
      { x: halfWidth, z: -halfDepth },
      { x: -halfWidth, z: halfDepth },
      { x: halfWidth, z: halfDepth },
    ]

    corners.forEach((corner) => {
      const worldX = transform.x + corner.x * cos - corner.z * sin
      const worldZ = transform.z + corner.x * sin + corner.z * cos
      minX = Math.min(minX, worldX)
      maxX = Math.max(maxX, worldX)
      minZ = Math.min(minZ, worldZ)
      maxZ = Math.max(maxZ, worldZ)
    })
  })

  const floorWidth = maxX - minX
  const floorDepth = maxZ - minZ
  const floorCenterX = (minX + maxX) / 2
  const floorCenterZ = (minZ + maxZ) / 2

  return {
    floorWidth,
    floorDepth,
    floorCenterX,
    floorCenterZ,
    minX,
    maxX,
    minZ,
    maxZ,
  }
}
