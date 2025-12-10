'use client'

import * as THREE from 'three'
import { Board } from '@/types'
import BoardThumbnail from './BoardThumbnail'

interface WallProps {
  position: [number, number, number]
  rotation: [number, number, number]
  boards: Board[]
  wallIndex: number
}

export default function Wall({ position, rotation, boards, wallIndex }: WallProps) {
  const wallWidth = 8
  const wallHeight = 5
  const wallDepth = 0.1

  return (
    <group position={position} rotation={rotation}>
      {/* Wall surface - light gallery wall */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[wallWidth, wallHeight, wallDepth]} />
        <meshStandardMaterial
          color="#f8f9fa"
          roughness={0.9}
          metalness={0.0}
        />
      </mesh>

      {/* Wall frame/border for definition */}
      <lineSegments>
        <edgesGeometry
          attach="geometry"
          args={[new THREE.BoxGeometry(wallWidth, wallHeight, wallDepth)]}
        />
        <lineBasicMaterial attach="material" color="#cbd5e1" />
      </lineSegments>

      {/* Boards on this wall */}
      {boards.map((board, index) => {
        // Arrange boards in a grid on the wall
        const boardsPerRow = 2
        const row = Math.floor(index / boardsPerRow)
        const col = index % boardsPerRow

        const boardSpacing = 0.3
        const boardWidth = (wallWidth - boardSpacing * 3) / boardsPerRow
        const boardHeight = boardWidth * 0.7 // Landscape orientation

        // Position relative to wall center
        const x = -wallWidth / 2 + boardSpacing + col * (boardWidth + boardSpacing) + boardWidth / 2
        const y = wallHeight / 2 - boardSpacing - row * (boardHeight + boardSpacing) - boardHeight / 2

        return (
          <BoardThumbnail
            key={board.id}
            board={board}
            position={[x, y, wallDepth / 2 + 0.05]}
            width={boardWidth}
            height={boardHeight}
          />
        )
      })}
    </group>
  )
}
