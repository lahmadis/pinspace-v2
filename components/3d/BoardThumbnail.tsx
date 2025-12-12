'use client'

import React, { useState, useRef, useEffect, Suspense } from 'react'
import { Board } from '@/types'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Text, useTexture, Html } from '@react-three/drei'
import CommentPanel from '@/components/CommentPanel'
import { PDFTextureMaterial } from './PDFTexture'

interface BoardThumbnailProps {
  board: Board
  position: [number, number, number]
  width: number
  height: number
  onClick?: (board: Board) => void
  isHighlighted?: boolean
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
  meshRef 
}: { 
  imageUrl: string
  width: number
  height: number
  hovered: boolean
  isHighlighted?: boolean
  meshRef: React.RefObject<THREE.Mesh>
}) {
  const { gl } = useThree()
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  
  // Handle PDFs - show red placeholder
  if (imageUrl.toLowerCase().endsWith('.pdf')) {
    return (
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={[width, height, BOARD_THICKNESS]} />
        <meshStandardMaterial
          color="#ff4444"
          roughness={0.7}
          metalness={0.0}
          emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
          emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
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
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[width, height, BOARD_THICKNESS]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.7}
        metalness={0.0}
        emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
        emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
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
  meshRef 
}: { 
  boardId: string
  width: number
  height: number
  hovered: boolean
  isHighlighted?: boolean
  meshRef: React.RefObject<THREE.Mesh>
}) {
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  
  // Generate a unique color based on board ID
  const getColorFromId = (id: string) => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hue = (hash * 137.5) % 360
    return `hsl(${hue}, 25%, 92%)`
  }

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[width, height, BOARD_THICKNESS]} />
      <meshStandardMaterial
        color={hovered ? '#e0e7ff' : getColorFromId(boardId)}
        roughness={0.7}
        metalness={0.0}
        emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
        emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
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
  meshRef 
}: { 
  pdfUrl: string
  title: string
  width: number
  height: number
  hovered: boolean
  isHighlighted?: boolean
  meshRef: React.RefObject<THREE.Mesh>
}) {
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[width, height, BOARD_THICKNESS]} />
      <PDFTextureMaterial pdfUrl={pdfUrl} hovered={hovered} />
    </mesh>
  )
}

export default function BoardThumbnail({ board, position, width, height, onClick, isHighlighted }: BoardThumbnailProps) {
  const [hovered, setHovered] = useState(false)
  const [stickyHovered, setStickyHovered] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)
  const stickyRef = useRef<THREE.Group>(null)
  
  // Combined hover state: true if pointer hovered OR board is highlighted (in camera view)
  const isHovered = hovered || !!isHighlighted

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
    
    // Animate sticky note on hover
    if (stickyRef.current) {
      const targetScale = stickyHovered ? 1.15 : 1
      const currentScale = stickyRef.current.scale.x
      stickyRef.current.scale.set(
        currentScale + (targetScale - currentScale) * 0.15,
        currentScale + (targetScale - currentScale) * 0.15,
        1
      )
      
      // Slight rotation bounce on hover
      const targetRotation = stickyHovered ? -0.2 : -0.15
      const currentRotation = stickyRef.current.rotation.z
      stickyRef.current.rotation.z = currentRotation + (targetRotation - currentRotation) * 0.15
    }
  })

  const handleClick = () => {
    // Only call onClick if provided - no default navigation
    if (onClick) {
      onClick(board)
    }
    // Removed default navigation to board detail page
    // Clicking boards now only triggers the onClick handler (e.g., for selection or lightbox)
  }

  return (
    <group 
      position={position}
      onClick={handleClick}
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
            />
          }>
            <BoardImage 
              imageUrl={imageUrl!}
              width={width}
              height={height}
              hovered={isHovered}
              isHighlighted={isHighlighted}
              meshRef={meshRef}
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

      {/* Comment Count Sticky Note */}
      {board.comments && board.comments.length > 0 && (
        <>
          <group 
            ref={stickyRef}
            position={[
              width / 2 + width * 0.03, // Stick out more from corner
              height / 2 + height * 0.03, 
              0.12 // Further in front
            ]}
            rotation={[0, 0, -0.15]} // Initial rotation
            onClick={(e) => {
              e.stopPropagation()
              console.log('💬 [Sticky Note] Clicked - Opening comments for board:', board.id)
              // Use onClick prop if provided (view mode), otherwise open modal
              if (onClick) {
                onClick(board)
              } else {
                setShowComments(true)
              }
            }}
            onPointerOver={(e) => {
              e.stopPropagation()
              setStickyHovered(true)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={(e) => {
              e.stopPropagation()
              setStickyHovered(false)
              document.body.style.cursor = 'default'
            }}
          >
            {/* Soft shadow (multiple layers for depth) */}
            <mesh position={[0.015, -0.015, -0.003]}>
              <planeGeometry args={[width * 0.14, height * 0.14]} />
              <meshBasicMaterial 
                color="#000000" 
                transparent 
                opacity={0.1}
              />
            </mesh>
            <mesh position={[0.008, -0.008, -0.002]}>
              <planeGeometry args={[width * 0.14, height * 0.14]} />
              <meshBasicMaterial 
                color="#000000" 
                transparent 
                opacity={0.15}
              />
            </mesh>

            {/* Sticky note background with gradient effect */}
            <mesh>
              <planeGeometry args={[width * 0.14, height * 0.14]} />
              <meshStandardMaterial 
                color="#ffd966"
                roughness={0.6}
                metalness={0.0}
                emissive={stickyHovered ? "#ffed4e" : "#ffd966"}
                emissiveIntensity={stickyHovered ? 0.4 : 0.2}
              />
            </mesh>

            {/* Glow effect on hover */}
            {stickyHovered && (
              <mesh position={[0, 0, -0.001]}>
                <planeGeometry args={[width * 0.18, height * 0.18]} />
                <meshBasicMaterial 
                  color="#ffd966"
                  transparent 
                  opacity={0.3}
                />
              </mesh>
            )}

            {/* Corner curl effect */}
            <mesh position={[width * 0.06, width * 0.06, 0.001]} rotation={[0, 0, Math.PI / 4]}>
              <planeGeometry args={[width * 0.03, height * 0.03]} />
              <meshStandardMaterial 
                color="#f4c430"
                roughness={0.7}
                metalness={0.0}
              />
            </mesh>

            {/* Comment count text - larger and bolder */}
            <Text
              position={[0, 0, 0.002]}
              fontSize={width * 0.10}
              color="#5a4a0a"
              anchorX="center"
              anchorY="middle"
              fontWeight={800}
              outlineWidth={0.002}
              outlineColor="#ffffff"
            >
              {board.comments.length}
            </Text>
          </group>

          {/* Comment Panel Overlay */}
          {showComments && (
            <Html center>
              <CommentPanel
                boardId={board.id}
                boardTitle={board.title}
                onClose={() => {
                  console.log('💬 [Comment Panel] Closing')
                  setShowComments(false)
                }}
              />
            </Html>
          )}
        </>
      )}
    </group>
  )
}