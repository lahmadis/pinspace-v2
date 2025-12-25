'use client'

import React, { useState, useRef, useEffect, Suspense } from 'react'
import { Board } from '@/types'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture, Html } from '@react-three/drei'
import { PDFTextureMaterial } from './PDFTexture'

interface BoardThumbnailProps {
  board: Board
  position: [number, number, number]
  width: number
  height: number
  onClick?: (board: Board) => void
  isHighlighted?: boolean
  onHover?: (hovered: boolean) => void // Callback when board hover state changes
}

// Error boundary for texture loading
class TextureErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('Texture loading failed:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

// Component that loads and displays the texture
function BoardImage({ 
  imageUrl, 
  width, 
  height, 
  hovered, 
  isHighlighted,
  meshRef,
  onClick
}: { 
  imageUrl: string
  width: number
  height: number
  hovered: boolean
  isHighlighted?: boolean
  meshRef: React.RefObject<THREE.Mesh>
  onClick?: (e: any) => void
}) {
  const { gl } = useThree()
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  
  // Handle PDFs - show red placeholder
  if (imageUrl.toLowerCase().endsWith('.pdf')) {
    return (
      <mesh 
        ref={meshRef} 
        castShadow 
        receiveShadow 
        renderOrder={1}
        onClick={onClick}
      >
        <boxGeometry args={[width, height, BOARD_THICKNESS]} />
        <meshStandardMaterial
          color="#ff4444"
          roughness={0.7}
          metalness={0.0}
          emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
          emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
          depthWrite={true}
          depthTest={true}
        />
      </mesh>
    )
  }
  
  // Use Suspense for texture loading - this handles the loading state properly
  const texture = useTexture(imageUrl)
  
  // Configure texture for better quality and performance
  useEffect(() => {
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      // Limit anisotropy to 2 for better performance on Vercel (reduced from 4)
      texture.anisotropy = Math.min(2, gl.capabilities.getMaxAnisotropy())
      texture.needsUpdate = true
    }
  }, [texture, gl])
  
  return (
    <mesh 
      ref={meshRef} 
      castShadow 
      receiveShadow 
      renderOrder={1}
      onClick={onClick}
    >
      <boxGeometry args={[width, height, BOARD_THICKNESS]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.7}
        metalness={0.0}
        emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
        emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
        depthWrite={true}
        depthTest={true}
      />
    </mesh>
  )
}

// Fallback component when image fails to load or is loading
function BoardFallback({ 
  boardId, 
  width, 
  height, 
  hovered, 
  isHighlighted,
  meshRef,
  onClick
}: { 
  boardId: string
  width: number
  height: number
  hovered: boolean
  isHighlighted?: boolean
  meshRef: React.RefObject<THREE.Mesh>
  onClick?: (e: any) => void
}) {
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  
  // Generate a unique color based on board ID
  const getColorFromId = (id: string) => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hue = (hash * 137.5) % 360
    return `hsl(${hue}, 25%, 92%)`
  }

  return (
    <mesh 
      ref={meshRef} 
      castShadow 
      receiveShadow 
      renderOrder={1}
      onClick={onClick}
    >
      <boxGeometry args={[width, height, BOARD_THICKNESS]} />
      <meshStandardMaterial
        color={hovered ? '#e0e7ff' : getColorFromId(boardId)}
        roughness={0.7}
        metalness={0.0}
        emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
        emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
        depthWrite={true}
        depthTest={true}
      />
    </mesh>
  )
}

// PDF component - renders actual PDF content as texture
function BoardPDF({ 
  pdfUrl,
  title,
  width, 
  height, 
  hovered, 
  isHighlighted,
  meshRef,
  onClick
}: { 
  pdfUrl: string
  title: string
  width: number
  height: number
  hovered: boolean
  isHighlighted?: boolean
  meshRef: React.RefObject<THREE.Mesh>
  onClick?: (e: any) => void
}) {
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  return (
    <mesh 
      ref={meshRef} 
      castShadow 
      receiveShadow 
      renderOrder={1}
      onClick={onClick}
    >
      <boxGeometry args={[width, height, BOARD_THICKNESS]} />
      <PDFTextureMaterial pdfUrl={pdfUrl} hovered={hovered} />
    </mesh>
  )
}

export default function BoardThumbnail({ board, position, width, height, onClick, isHighlighted, onHover }: BoardThumbnailProps) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)
  
  // Combined hover state: true if pointer hovered OR board is highlighted (in camera view)
  const isHovered = hovered || !!isHighlighted

  // Notify parent of hover state changes
  useEffect(() => {
    onHover?.(hovered)
  }, [hovered, onHover])


  // Check if we have a valid image URL
  const imageUrl = board.fullImageUrl || board.thumbnailUrl
  const isPDF = imageUrl?.toLowerCase().endsWith('.pdf')
  // Allow both local /uploads/ paths and external URLs (e.g., Supabase storage)
  const hasValidImage = imageUrl && (
    imageUrl.startsWith('/uploads/') || 
    imageUrl.startsWith('http://') || 
    imageUrl.startsWith('https://')
  ) && !isPDF

  // Subtle animation on hover
  useFrame(() => {
    if (meshRef.current) {
      const targetZ = isHovered ? 0.15 : 0
      meshRef.current.position.z += (targetZ - meshRef.current.position.z) * 0.1
    }
  })

  const handleClick = (e: any) => {
    // Open comment panel when board is clicked
    if (onClick) {
      e.stopPropagation() // Prevent event bubbling
      onClick(board)
    }
  }

  return (
    <group 
      position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Board surface with texture, PDF display, or fallback color */}
      {isPDF ? (
        <BoardPDF
          pdfUrl={imageUrl!}
          title={board.title}
          width={width}
          height={height}
          hovered={isHovered}
          isHighlighted={isHighlighted}
          meshRef={meshRef}
          onClick={handleClick}
        />
      ) : hasValidImage ? (
        <TextureErrorBoundary
          fallback={
            <BoardFallback 
              boardId={board.id}
              width={width}
              height={height}
              hovered={isHovered}
              isHighlighted={isHighlighted}
              meshRef={meshRef}
              onClick={handleClick}
            />
          }
        >
          <Suspense fallback={
            <BoardFallback 
              boardId={board.id}
              width={width}
              height={height}
              hovered={isHovered}
              isHighlighted={isHighlighted}
              meshRef={meshRef}
              onClick={handleClick}
            />
          }>
            <BoardImage 
              imageUrl={imageUrl!}
              width={width}
              height={height}
              hovered={isHovered}
              isHighlighted={isHighlighted}
              meshRef={meshRef}
              onClick={handleClick}
            />
          </Suspense>
        </TextureErrorBoundary>
      ) : (
        <BoardFallback 
          boardId={board.id}
          width={width}
          height={height}
          hovered={isHovered}
          isHighlighted={isHighlighted}
          meshRef={meshRef}
          onClick={handleClick}
        />
      )}

      {/* Owner name tooltip - only show on hover */}
      {(() => {
        // Get the display name: prefer studentName, fallback to ownerName
        // Only show if we have a valid name (not empty, "Anonymous", or "Uploaded Board")
        const displayName = (board.studentName && board.studentName !== 'Anonymous' && board.studentName !== 'Uploaded Board'
          ? board.studentName 
          : (board.ownerName && board.ownerName !== 'Anonymous' && board.ownerName !== 'Uploaded Board' ? board.ownerName : null))
        
        return isHovered && displayName ? (
          <Html
            position={[0, -height / 2 - 0.1, 0.1]}
            center
            distanceFactor={10}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{
              background: 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}>
              {displayName}
            </div>
          </Html>
        ) : null
      })()}


      {/* Frame around board when hovered or highlighted */}
      {(isHovered || isHighlighted) && (
        <>
          <lineSegments position={[0, 0, 0.002]}>
            <edgesGeometry
              attach="geometry"
              args={[new THREE.PlaneGeometry(width + 0.03, height + 0.03)]}
            />
            <lineBasicMaterial attach="material" color="#6366f1" linewidth={3} />
          </lineSegments>
          
          {/* Subtle glow effect */}
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[width + 0.1, height + 0.1]} />
            <meshBasicMaterial
              color="#6366f1"
              transparent
              opacity={0.1}
            />
          </mesh>
        </>
      )}

      {/* Sticky notes removed - comments accessible via board click */}
    </group>
  )
}