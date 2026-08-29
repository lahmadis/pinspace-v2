'use client'

import '@/components/3d/setupDraco'
import { Suspense, useMemo, useEffect } from 'react'
import { useGLTF, Center } from '@react-three/drei'
import * as THREE from 'three'
import type { FloorTable } from '@/types'
import { useRhino3dm } from '@/components/3d/useRhino3dm'
import { useStlLoader } from '@/components/3d/useStlLoader'
import { consumeDoubleClick } from '@/lib/room/consumeDoubleClick'

function is3dm(url: string) {
  return url.toLowerCase().endsWith('.3dm')
}

function isStl(url: string) {
  return url.toLowerCase().endsWith('.stl')
}

const TABLE_HEIGHT = 18 // 1.5 feet in inches

function isModelUrlLoadable(url: string): boolean {
  return url.length > 0 && !url.startsWith('blob:')
}

const TABLE_TOP_MARGIN = 0.5 // inches – minimal gap so model fills table
/**
 * What every on-table model is recoloured to.
 *
 * A light NEUTRAL grey. Uploaded models arrive in whatever colours their author gave
 * them, so they are flattened to one tone; that tone used to be pure white,
 * which put them at the same value as the walls, the plinth and very nearly the
 * sky, and left them reading as grey lumps that only shading told apart.
 *
 * Grey, not the accent tint it carried for a while. The room is already an
 * almost entirely blue-white field — near-white walls on a #EDF1FB sky — and a
 * blue-tinted object in it reads as part of that field rather than as a thing
 * standing in it. Neutral is what separates the work from the room.
 *
 * It must stay well clear of the accent (#3B6EF6) too: the accent means
 * ACTIVE/SELECTED everywhere else in the room (see lib/room/palette), and a
 * model permanently wearing it would read as permanently selected.
 *
 * Read it together with EMISSIVE_BASE below, never tuned alone: what you see
 * is this colour times the light on that face, PLUS this colour times the
 * emissive. Darkening one and raising the other cancel out.
 *
 * WHY WHITE KEPT SHOWING THROUGH A GREY. RoomLighting puts ~1.31 on a face
 * turned toward the key; add the emissive term and the multiplier was ~1.51.
 * Anything above 1.0 CLIPS, so every base lighter than about #D4D4D4 rendered
 * its lit faces as flat white no matter how grey the swatch was — you were
 * seeing the ceiling, not the colour. Darkening the base alone would not have
 * fixed it either; the emissive below came down at the same time to pull the
 * multiplier under 1.0 so the top faces have somewhere to go.
 */
const MODEL_COLOR = '#C2C6CC'

/**
 * The plinth under the model.
 *
 * Grey now as well, and deliberately a step LIGHTER than the model rather than
 * the same tone. It was pure white, which was fine while the model was tinted
 * — the two separated by hue — but two neutrals at the same value would merge
 * into one grey mass, and it is the model that should read as the object.
 * Lighter also lets the plinth sit closer to the walls and recede, which is
 * what a plinth is for.
 */
const PLINTH_COLOR = '#E3E6EA'
/**
 * A little self-light so the faces turned away from the key do not fall to a
 * flat dark grey.
 *
 * Halved from 0.2. It is the term that was tipping lit faces over 1.0 and
 * clipping them to white (see MODEL_COLOR above) — and it is the cheaper half
 * to give up, because it only ever mattered on the shaded side. Lowering it
 * costs a little shadow lift; lowering the colour instead would have cost the
 * whole object.
 */
const EMISSIVE_BASE = 0.1
/*
 * NO hover brightening.
 *
 * Hovering used to lift emissive from 0.2 to 0.45, which visibly washed the
 * model out — and since a click is preceded by a hover, it read as "clicking
 * makes it lighter". The mark it was giving feedback with was the object's own
 * colour, so the feedback was indistinguishable from the model being a
 * different colour. The pointer cursor set in handlePointerOver is the
 * affordance; it says the same thing without touching the work.
 *
 * If a visual hover state is wanted later it must not be VALUE — an outline or
 * a contact shadow, something that is not the model's own surface.
 */

/**
 * Forced onto every uploaded model, and the reason they stopped rendering dark.
 *
 * glTF defaults `metallicFactor` to 1.0, so a .glb whose author never wrote a
 * pbrMetallicRoughness block arrives FULLY METALLIC. A metal surface shows the
 * environment reflected in it — and this room has no environment map — so it
 * reflects nothing and renders near-black no matter what base colour it is
 * given. That is why lightening MODEL_COLOR twice barely moved it.
 *
 * Matches the walls, which set metalness 0 / roughness 0.85 inline for the same
 * reason: everything in this room is matte paper and plaster.
 */
const MODEL_METALNESS = 0
const MODEL_ROUGHNESS = 0.85

/**
 * Recolour a cloned scene to MODEL_COLOR, matte.
 *
 * FIRST it gives the clone its OWN materials. `Object3D.clone()` copies the
 * node graph but every mesh keeps a REFERENCE to the source material — and the
 * source here is useGLTF's global cache, shared with anything else showing the
 * same file. Mutating in place therefore reached out of this component: opening
 * a model in the full-screen viewer (which paints its copy white for a
 * product-shot look) repainted the one standing in the room, so closing the
 * viewer left a white model on its plinth. Same in reverse. Cloning the
 * materials is what makes "this surface's colour" a local decision.
 */
function applyWallColor(scene: THREE.Object3D) {
  const color = new THREE.Color(MODEL_COLOR)
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.material) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone()
      const mats = Array.isArray(mesh.material)
        ? mesh.material as THREE.Material[]
        : [mesh.material as THREE.Material]
      mats.forEach((m) => {
        const standard = m as THREE.MeshStandardMaterial
        if (standard.color) standard.color.copy(color)
        if (standard.map) standard.map = null
        if (standard.emissiveMap) standard.emissiveMap = null
        // The maps go too. Clearing metalness while leaving a metalnessMap in
        // place keeps the mask multiplying against it, so a model would stay
        // metal exactly where its texture said to be.
        if (standard.metalnessMap) standard.metalnessMap = null
        if (standard.roughnessMap) standard.roughnessMap = null
        if (standard.metalness !== undefined) standard.metalness = MODEL_METALNESS
        if (standard.roughness !== undefined) standard.roughness = MODEL_ROUGHNESS
        if (standard.emissive) {
          standard.emissive.copy(color)
          standard.emissiveIntensity = EMISSIVE_BASE
        }
      })
    }
  })
}

type ModelOnTableProps = { url: string; tableWidth: number; tableDepth: number }

function useScaledClone(scene: THREE.Object3D, tableWidth: number, tableDepth: number) {
  return useMemo(() => {
    const c = scene.clone(true)
    applyWallColor(c)
    const box = new THREE.Box3().setFromObject(c)
    const sizeVec = box.getSize(new THREE.Vector3())
    const fitWidth = Math.max(1, tableWidth - TABLE_TOP_MARGIN * 2)
    const fitDepth = Math.max(1, tableDepth - TABLE_TOP_MARGIN * 2)
    const scaleX = sizeVec.x > 1e-6 ? fitWidth / sizeVec.x : 1
    const scaleZ = sizeVec.z > 1e-6 ? fitDepth / sizeVec.z : 1
    const scale = Math.min(scaleX, scaleZ)
    return { cloned: c, scale, size: sizeVec }
  }, [scene, tableWidth, tableDepth])
}

function ScaledModel({
  cloned, scale, size,
}: {
  cloned: THREE.Object3D
  scale: number
  size: THREE.Vector3
}) {
  // Emissive is set once, at clone time, by applyWallColor. Nothing changes it
  // afterwards — see the note on EMISSIVE_BASE above.

  useEffect(() => {
    return () => {
      cloned.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        // Materials only. The GEOMETRY is still the cached original's — clone()
        // shares it the same way it shared materials — so disposing it here
        // would free buffers that useGLTF's cache still hands to the next
        // mount, and the model would come back as nothing. The materials ARE
        // ours (applyWallColor cloned them), so they are ours to free.
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((m) => (m as THREE.Material)?.dispose())
      })
    }
  }, [cloned])

  return (
    <group position={[0, TABLE_HEIGHT, 0]} scale={scale}>
      {/*
        NO invisible hit-test box.
        There was one here: a transparent mesh spanning the model's whole
        bounding volume plus an inch in every direction, added so a click on the
        model could not fall through to the wall behind it. But a sculpture is
        not a box, and its bounding box is mostly empty air — so the grab area
        reached out over whatever was behind it, and hovering a board hanging on
        the wall selected the model floating in front of that board.
        The real geometry is raycastable on its own: R3F walks descendants of
        the handler-bearing <group> in TableWithModel, and the pedestal below is
        a real mesh too. So the model is hit when the ray actually meets the
        model, the plinth when it meets the plinth, and the wall when it meets
        neither — which is the behaviour the box was approximating.
        The fall-through it guarded against is handled where it should be, by
        the stopPropagation already in that group's click and pointer handlers.
      */}
      <group position={[0, size.y / 2, 0]}>
        <Center>
          <primitive object={cloned} />
        </Center>
      </group>
    </group>
  )
}

function GlbModelOnTable({
  url, tableWidth, tableDepth,
}: ModelOnTableProps) {
  const { scene } = useGLTF(url)
  const { cloned, scale, size } = useScaledClone(scene, tableWidth, tableDepth)
  return <ScaledModel cloned={cloned} scale={scale} size={size} />
}

function RhinoModelOnTable({
  url, tableWidth, tableDepth,
}: ModelOnTableProps) {
  const { scene } = useRhino3dm(url)
  const { cloned, scale, size } = useScaledClone(scene, tableWidth, tableDepth)
  return <ScaledModel cloned={cloned} scale={scale} size={size} />
}

function StlModelOnTable({
  url, tableWidth, tableDepth,
}: ModelOnTableProps) {
  // STL carries no material/color; useStlLoader gives it a default gray
  // MeshStandardMaterial. It then goes through the same scale/center/recolor
  // (applyWallColor) treatment as every other on-table model, so it sits on the
  // table consistently with .glb/.3dm.
  const { scene } = useStlLoader(url)
  const { cloned, scale, size } = useScaledClone(scene, tableWidth, tableDepth)
  return <ScaledModel cloned={cloned} scale={scale} size={size} />
}

function ModelOnTable({
  url, tableWidth, tableDepth,
}: ModelOnTableProps) {
  if (is3dm(url)) return <RhinoModelOnTable url={url} tableWidth={tableWidth} tableDepth={tableDepth} />
  if (isStl(url)) return <StlModelOnTable url={url} tableWidth={tableWidth} tableDepth={tableDepth} />
  return <GlbModelOnTable url={url} tableWidth={tableWidth} tableDepth={tableDepth} />
}

interface TableWithModelProps {
  table: FloorTable
  onTableClick?: (modelUrl: string) => void
}

export default function TableWithModel({ table, onTableClick }: TableWithModelProps) {
  const hasModel = Boolean(table.modelUrl && isModelUrlLoadable(table.modelUrl))

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (hasModel && table.modelUrl && onTableClick) onTableClick(table.modelUrl)
  }

  // A wall's invisible raycast plane opens 2D edit mode on double click, and a
  // table usually has a wall somewhere behind it along the ray. R3F only stops
  // the intersection walk on objects that actually carry the named handler, so
  // handleClick's stopPropagation does nothing for dblclick — without this, a
  // double click on a table would open the model viewer AND drop edit mode
  // behind it. Swallow unconditionally: the table occludes the wall.
  const handleDoubleClick = (e: { stopPropagation: () => void; nativeEvent?: { stopPropagation: () => void } }) => {
    consumeDoubleClick(e)
  }

  const handlePointerOver = (e: { stopPropagation: () => void }) => {
    if (!hasModel) return
    e.stopPropagation()
    if (typeof document !== 'undefined') document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    if (typeof document !== 'undefined') document.body.style.cursor = ''
  }

  const rotationY = table.rotation ?? 0
  return (
    <group
      position={[table.x, 0, table.z]}
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {/* Table pedestal */}
      <mesh position={[0, TABLE_HEIGHT / 2, 0]}>
        <boxGeometry args={[table.width, TABLE_HEIGHT, table.depth]} />
        {/* Furniture, not work — see PLINTH_COLOR for why it is lighter than
            the model rather than matching it. */}
        <meshStandardMaterial color={PLINTH_COLOR} roughness={0.9} metalness={0} />
      </mesh>

      {hasModel && (
        <Suspense
          fallback={
            <mesh position={[0, TABLE_HEIGHT + 2, 0]}>
              <boxGeometry args={[4, 4, 4]} />
              <meshStandardMaterial color="#888" wireframe />
            </mesh>
          }
        >
          <ModelOnTable
            url={table.modelUrl!}
            tableWidth={table.width}
            tableDepth={table.depth}
          />
        </Suspense>
      )}
    </group>
  )
}
