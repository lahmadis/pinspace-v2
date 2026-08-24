/**
 * Mark a double-click inside the 3D canvas as fully handled.
 *
 * Two propagations have to be stopped, and stopping only the first is the easy
 * mistake:
 *
 *  - `stopPropagation()` ends R3F's own raycast walk, so objects BEHIND this one
 *    don't also receive the double-click. Every 3D object that means something
 *    on double-click already did this.
 *  - `nativeEvent.stopPropagation()` stops the underlying DOM event before it
 *    bubbles out of the canvas. This matters because the canvas wrapper carries
 *    a double-click handler that leaves wall-edit mode — the "double-click into
 *    the space to get out" gesture. React 18 delegates its listeners to the root
 *    container, above the canvas, so without this an object's double-click would
 *    do its own job AND drop the user out of edit mode.
 *
 * The rule: if a 3D object handles a double-click, it consumes it with this.
 * Anything that doesn't is, by definition, "the space", and exits edit mode.
 *
 * This applies to drei `<Html>` overlays too, and there it's easy to miss: each
 * `<Html>` mounts its OWN React root inside the canvas container, so a synthetic
 * `stopPropagation` in one of its DOM handlers doesn't even stop that root's
 * ancestors, let alone the native event. An interactive badge or button in an
 * overlay therefore needs this exactly as much as a mesh does.
 */
export function consumeDoubleClick(e: {
  stopPropagation: () => void
  nativeEvent?: { stopPropagation: () => void }
}): void {
  e.stopPropagation()
  e.nativeEvent?.stopPropagation()
}
