'use client'

/**
 * The room's light rig. One definition, used by every surface that renders
 * <WallSystem> — the editor, studio view, the guest crit and share links, and
 * both demo rooms. It was copy-pasted into all six with a comment in each
 * saying "match StudioRoom", and they had already drifted into three different
 * rigs, so the same room looked different depending on how you reached it.
 *
 *
 * WHY IT IS THIS DIM
 *
 * The old rig stacked ambient 0.5 + five directional lights (1.2 + 0.5 + 0.4 +
 * 0.3 + 0.3) + a hemisphere. A vertical wall face was receiving well over 1.0
 * before its own albedo was applied, and the wall's albedo is #FFFFFF — so
 * every face clipped to pure white. Faces pointing in completely different
 * directions rendered as the same flat value, which is what made the walls read
 * as chalky and lifeless: not a soft surface, a blown-out one. The five lights
 * were each added to fix the flatness the previous one caused.
 *
 * The budget below keeps the brightest vertical face just under 1.0 so shading
 * actually has somewhere to go, and the tones land roughly where the reference
 * this was tuned against puts its three cube faces — top lightest, front a step
 * down, the away-facing side a step below that:
 *
 *   surface                         old        now      reference
 *   wall top edge                   1.00       ~1.00    1.00
 *   wall face toward the key        1.00       ~0.82    0.85
 *   wall face away from the key     1.00       ~0.70    0.70
 *
 * Three real values instead of one clipped one. The softness comes from the
 * hemisphere light carrying most of the fill: it varies smoothly with a
 * surface's up-ness, so there is no terminator line anywhere, and nothing ever
 * falls to black — the darkest face still sits at ~0.70.
 *
 * Material roughness is deliberately NOT touched to get here. Specular scales
 * with light intensity, so at this budget the boards' 0.7 roughness no longer
 * produces a visible hot spot, and the wall keeps matching the board sheen
 * exactly as WALL_PALETTES intends.
 */

/** Uniform floor under everything. Low — the hemisphere does the filling. */
const AMBIENT_INTENSITY = 0.22

/**
 * The soft one. Sky above, a cool grey below, blended by surface normal — this
 * is what makes an upward face read lighter than a vertical one without a hard
 * edge between them. Ground is tinted rather than neutral so shaded faces stay
 * in the same cool family as ROOM_SKY_COLOR instead of going warm-grey.
 */
const HEMI_INTENSITY = 0.46
const HEMI_SKY = '#FFFFFF'
const HEMI_GROUND = '#D6DEEA'

/**
 * Key light. Kept high and well clear of the room — with shadows off across the
 * room, its only job is deciding which faces read brighter, and that is the
 * whole of the depth cue now that nothing is cast onto anything.
 */
const KEY_INTENSITY = 0.5
const KEY_POSITION: [number, number, number] = [400, 700, 300]

/**
 * A single gentle counter-light, opposite the key. Replaces the four fill/rim
 * lights: they existed to rescue faces the over-bright key had flattened, and
 * at this budget the hemisphere already keeps the away side at ~0.70. Low
 * enough that it lifts the back faces without erasing the key's direction.
 */
const FILL_INTENSITY = 0.12
const FILL_POSITION: [number, number, number] = [-320, 420, -280]

export default function RoomLighting() {
  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY]} />
      <directionalLight position={KEY_POSITION} intensity={KEY_INTENSITY} />
      <directionalLight position={FILL_POSITION} intensity={FILL_INTENSITY} />
    </>
  )
}
