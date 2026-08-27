'use client'

import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

/**
 * The room's light rig and its tone response. One definition, used by every
 * surface that renders <WallSystem> — the editor, studio view, the guest crit
 * and share links, and both demo rooms. It was copy-pasted into all six with a
 * comment in each saying "match StudioRoom", and they had already drifted into
 * three different rigs, so the same room looked different depending on how you
 * reached it.
 *
 *
 * WHY TONE MAPPING IS OFF
 *
 * react-three-fiber's <Canvas> sets ACESFilmicToneMapping by default. ACES is a
 * film curve: it is built to take a huge exposure range and squeeze it into a
 * screen, which it does by crushing mid-tones and rolling off everything near
 * white. That is right for a lit 3D scene with a sun in it. It is wrong here.
 *
 * This room is a white gallery. Its whole subject is white sheets on white
 * walls, and it is built almost entirely out of ALBEDO differences a few
 * percent apart — WALL_PALETTES separates a wall face from its edge strips by
 * about 4% at a time. ACES compresses hardest in exactly that band, so those
 * steps collapsed into each other and #FFFFFF walls rendered as mid grey.
 *
 * With NoToneMapping the linear value goes straight to sRGB: white albedo under
 * full light IS white, and a 4% albedo step stays a 4% step. It also means a
 * scanned drawing renders as the file rather than as a graded version of it,
 * which for a crit tool is the point.
 *
 * Set here rather than on six <Canvas> gl props because it belongs with the
 * light budget below — the two only make sense calibrated together.
 *
 *
 * WHY THE BUDGET IS WHAT IT IS
 *
 * A previous pass cut total intensity from ~3.5 to ~1.0 on the theory that the
 * old rig was clipping every face to white. That was wrong twice over: the
 * arithmetic ignored the tone curve above, and the direction was backwards —
 * the room came out dark and heavy rather than blown out.
 *
 * The balance leans hard on ambient + hemisphere, which are shadowless, and
 * uses the directional key only to keep the faces from being identical. That is
 * what makes it read as soft: a white room is lit by bounce, not by a spotlight,
 * and strong directional shading on white walls is what made them look heavy.
 * Faces land between roughly 0.86 and 1.0 of full white — bright and gentle,
 * with the wall's own edge tones (not the lighting) doing the work of saying
 * which face is which.
 *
 * THE NUMBERS LOOK BIG BECAUSE THEY HAVE TO BE. three r160 defaults
 * `useLegacyLights` to false and r3f does not override it, so nothing
 * compensates for the 1/PI in the Lambert BRDF: a surface receives roughly a
 * THIRD of the intensity you write here. Summing these four and expecting the
 * total is how the previous pass talked itself into a rig three times too dim.
 * Reason in terms of `sum / PI` — that is the number that lands on a face.
 */

/**
 * Single exposure knob. Every intensity below is scaled by it, so the whole
 * room brightens or dims without disturbing the balance between the four
 * lights. Raise it if the walls read grey, lower it if the edge strips wash
 * out — those are the two failure modes, and they are opposite ends of this
 * one number.
 */
const EXPOSURE = 1.0

/** Flat, shadowless base. Large on purpose — see the note on softness above. */
const AMBIENT_INTENSITY = 0.87 * EXPOSURE

/**
 * The soft one. Sky above, a barely-cooler tone below, blended by surface
 * normal — an upward face reads a little lighter than a vertical one with no
 * edge between them. The ground tone is kept close to the sky so shaded faces
 * stay white rather than going grey; the separation here is a tint, not a
 * value drop.
 */
const HEMI_INTENSITY = 1.7 * EXPOSURE
const HEMI_SKY = '#FFFFFF'
const HEMI_GROUND = '#E8EEF8'

/**
 * Key light. High and well clear of the room. With shadows off across the room
 * its only job is deciding which faces read brighter, so it is deliberately the
 * smaller half of the budget — enough for the room to have a direction, not
 * enough to carve it.
 */
const KEY_INTENSITY = 1.2 * EXPOSURE
const KEY_POSITION: [number, number, number] = [400, 700, 300]

/**
 * A single gentle counter-light opposite the key, so the away side is not the
 * one flat face in the room. Replaces four separate fill/rim lights that
 * existed to rescue faces an over-bright key had flattened.
 */
const FILL_INTENSITY = 0.35 * EXPOSURE
const FILL_POSITION: [number, number, number] = [-320, 420, -280]

export default function RoomLighting() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const previous = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    // Restored on unmount: the renderer outlives this component in a room that
    // swaps scenes, and silently leaving a global renderer setting changed is
    // how the next surface inherits a look nobody chose for it.
    return () => {
      gl.toneMapping = previous
    }
  }, [gl])

  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY]} />
      <directionalLight position={KEY_POSITION} intensity={KEY_INTENSITY} />
      <directionalLight position={FILL_POSITION} intensity={FILL_INTENSITY} />
    </>
  )
}
