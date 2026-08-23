# Known bugs and accepted limits

Living list for whoever picks these up. Each entry says what's wrong, where to
look, and — where it matters — why the obvious fix is wrong.

Ordered roughly by "how likely is this to bite a user".

---

## 0. FIXED — lint errors that were failing the Vercel build

`next.config.js` has `ignoreDuringBuilds: false` and `.eslintrc.json` sets
`@typescript-eslint/no-unused-vars` to **error**, so unused symbols block
deployment. The three in the build's lint scope are fixed:

| File | Symbol | Fix |
|---|---|---|
| `app/archive/page.tsx` | `isLoaded` | deleted (nothing read it) |
| `components/3d/FloorEditorOverlay.tsx` | `PlanBoundsLike` | dropped from the import |
| `components/3d/WallSystem.tsx` | `BOARD_DIM_AMOUNT` | renamed `_BOARD_DIM_AMOUNT` |

**`npx tsc --noEmit` does NOT catch these.** Unused variables are an ESLint
rule, not a type error, so a clean type check says nothing about whether the
build will pass. Check with:

```
npx eslint app components lib --ext .ts,.tsx --quiet
```

`--quiet` reports errors only, which is exactly the set that fails a build.
That command is clean as of this commit. CLAUDE.md says to skip `next lint`
because it hung; `npx eslint` on the build scope is the substitute and it
completes in about a minute.

**Still open, outside the build's lint scope:** `hooks/` is not linted by the
default scope (`app`, `components`, `lib`, `pages`, `src`), and
`hooks/useBoardUpload.ts` has three errors — two `no-explicit-any` (lines 80,
157) and an unused `rows` (line 566). They cannot fail the build today, but
they will the moment anything adds `hooks` to the lint scope.

---

## 1. OPEN — 2D wall edit: Ctrl+Z doesn't move the board until something else re-renders

**Symptom.** In 2D wall edit mode, move a board and press Ctrl+Z. Nothing
happens. Click anywhere else, or Save & Exit, and the board is at its original
position — so the undo *did* work, it just wasn't drawn.

**Root cause.** `DraggableBoard`'s position-sync effect
(`components/3d/DraggableBoard.tsx`, the `justFinishedDragging` guard) ignores
incoming position props after a drag ends. The timer that clears the flag does
not itself trigger a render, so once an undo is swallowed nothing re-runs the
effect — the undo stays invisible until an unrelated render happens along.

**Attempted fix, unverified.** A `positionEpoch` counter, bumped in
`useBoardState.applySnapshot` and threaded through `StudioRoom` → `SceneContent`
→ `DraggableBoard`, which overrides the post-drag hold. It was never actually
tested: the console log we used to diagnose it came from a dev server running
stale code (no `[UNDO-DIAG]` lines appeared at all). **Restart the dev server
and re-test before assuming it's broken.**

**Diagnostics.** Temporary `[UNDO-DIAG]` devLogs are in
`useBoardState.applySnapshot`, `useBoardState.undo` and `DraggableBoard`'s sync
effect. Remove them once this is settled.

---

## 2. OPEN — `PGRST205` is reported to the user as "apply the migration"

**Symptom.** `/api/canvases/[id]/summary` and `/deliverables` return 503 "needs
migration 040" when migration 040 *is* applied.

**Root cause.** Those routes treat PostgREST's `PGRST205` as "table absent".
It also means "table absent from the schema cache", which is the state for a
few minutes after any migration. The advice is then actively wrong.

**Fix.** Do what `scripts/cleanup-orphan-storage.ts` already does: treat only
Postgres's own `42P01` as absent, and report `PGRST205` as "schema cache is
stale, retry shortly". Workaround in the meantime:
`notify pgrst, 'reload schema';`

---

## 3. OPEN — a delete that commits but reports failure leaves a permanent ghost, in one case

**Where.** `useBoardState.commitBoardDelete` → `restoreAndReconcile`.

A DELETE can succeed server-side and still report an error (gateway timeout, a
keepalive response that never arrives). The board is restored locally and a
background refetch reconciles it — except when the refetch returns an EMPTY
list, because the parent-sync removal block is skipped in that case. So
"delete the only board in a room, and the delete reports a false failure"
leaves a board on screen that no longer exists. Needs a change to the
`initialBoards.length > 0` guard in the parent-sync effect, which is defended
code — read it carefully first.

---

## 4. OPEN — wall removal can still 409 in a narrow window

**Where.** `StudioRoom.handleWallRemoved`.

Deleting a board starts a 6-second undo window (see §"Deferred delete" below).
`handleWallRemoved` awaits `flushPendingDeletes` before counting boards, but
that only covers deletes still *held* — leaving edit mode already started their
requests, and those in-flight commits are not awaited. A 409 here is
non-destructive: the count is restated and a retry works.

---

## 5. OPEN — canvas line tools, two small geometry issues

**Where.** `InfiniteCanvas` line/arrow creation, `LINE_MIN_EXTENT`.

- A very short near-vertical flick (both extents under 10 canvas units) is
  stored as `axis: 'horizontal'` and draws as a short horizontal dash. A
  `h < w` tie-break would fix it.
- Any line under 10 units tall is silently straightened, moving its endpoints
  by up to 5 units. Defensible as snapping; undocumented in the UI.

## 6. OPEN — canvas selection bar can leave the bottom of the screen

Its x is clamped to the viewport but its y is not, so a selection taller than
the viewport can push the bar off the bottom. `InfiniteCanvas`, the
`selectionOverlay.anchor` block — `size.h` is available and unused.

---

## 7. OPEN — desk board: small edges in the recording and composer paths

All narrow, all in failure or edge paths. `app/desk-crits/page.tsx` unless noted.

- Stop, then start on a **different** crit within 500 ms cancels the pending
  save. The held text is tagged with its crit id so it cannot land in the wrong
  column, but it waits for that crit's next save.
- One composer slot: opening a note on another column silently discards text
  typed into the first. Switching kind on the same column keeps the value, so a
  half-typed note can become a step.
- Picking another tool does not close an open composer — it stays live in its
  column while the rail moves on.
- `localSummary.ts` treats `stop `, `avoid `, `without `, `instead of` and
  `rather than` as negations, so "Show the plan without the furniture" is not
  turned into a task. Deliberate: inverting an instruction is worse than
  missing one. Such sentences still reach the summary body.
- `CritColumn.tsx` — the ⌘ glyph in the composer hint is hardcoded, so Windows
  users see ⌘ rather than Ctrl.

## 8. DONE — trace and callouts are built, on canvas nodes not boards

The fork recorded here has been resolved in favour of **canvas nodes**, not
`boards`. Reusing boards would have meant making `boards.workspace_id` nullable
and reworking all four of its workspace-pivoting RLS policies, and "just use
their personal workspace" is not well defined — 8 users have several and 3 have
none.

So a mark is its own node with `props.onNodeId` pointing at the sheet it sits
on, and coordinates **normalised 0..1 against that sheet**:

| Mark | `type` | Key props |
|---|---|---|
| Trace stroke | `ink` | `onNodeId`, `pts` (0..1 pairs), `color`, `size` |
| Callout | `sticky` | `onNodeId`, `callout: true`, `nx`, `ny`, `text` |

Both types were already in migration 036's CHECK and `props` is JSON, so this
needed **no migration**.

**Marks do not cascade in the database.** `props.onNodeId` is JSON, not a
foreign key, so nothing enforces it. `CritColumn.removeSheet` sweeps a sheet's
marks before deleting the sheet — marks FIRST, so a half-failure leaves the
picture rather than the orphans. Any other path that deletes an image node must
do the same, or the marks survive their picture: unreachable, undeletable, and
still counted.

**The pen palette is shared; the storage is not.** `lib/trace/pens.ts` holds
the four colours and two weights, imported by BOTH the lightbox and the crit
workspace. This was a deliberate call (confirmed with the user): the two
annotation implementations cannot share storage without turning crit work into
`boards` rows — which would mean a migration, hiding a workspace from every
listing, and desk crits inheriting the boards access model (members and
superadmin) in place of their owner-only guarantee. They can share what the pen
looks like, and that is the part a user would notice drifting.

**Weights are stored as a FRACTION of the board, in both places.** The lightbox
draws to a canvas and multiplies by the rendered size. The crit workspace
strokes an SVG with `vectorEffect="non-scaling-stroke"`, which reinterprets
width in outer pixel space, so it converts with `tracePx(fraction, boxW)` at
paint time and observes its own box with a ResizeObserver. Passing the stored
fraction straight through drew a 0.004px hairline — invisible, while the rows
saved perfectly, so trace looked like it did nothing.

**Trace width is in PIXELS at paint time only.** The overlay's viewBox is 0..1 and the polyline
carries `vectorEffect="non-scaling-stroke"`, which reinterprets width in outer
pixel space. A width in viewBox units drew a 0.004px hairline — invisible,
while the rows saved perfectly, so trace looked like it did nothing.

**The callout composer opens on CLICK, never on pointerdown.** Opening it on
pointerdown destroyed it inside the same gesture: the textarea mounts and
autofocuses mid-click, then the remainder of that click moves focus away and
fires `onBlur`, which committed an empty draft and closed the composer. Nothing
appeared, so the button read as dead — twice. Two guards now, because either
alone leaves the trap armed: it opens on click, and blur only commits when
there is actually text. Trace stays on pointerdown, which is correct — it needs
the press to start a drag.

**Trace and callout open a sheet rather than sitting disabled.** They mark up
one sheet, so they need one open — but gating them behind that as a disabled
button meant pressing them did nothing at all, which reads as broken rather
than as a precondition. They now focus the first sheet and arm themselves, and
only go inert when nothing is pinned.

**The stage box is sized by `aspect-ratio`, not by the image.** It has to be
exactly the picture, because every mark is a percentage of it. It previously
shrink-wrapped an `<img>` capped at a hardcoded `calc(100vh-260px)` — a number
that knew nothing about the tab panel below, so opening the transcript (which
Record does automatically) shrank the container ~224px while the image's cap
did not, and every mark shifted. Do not reintroduce a hardcoded viewport cap.

**`pts`, deliberately not `points`.** The canvas's `points` meant pixels in a
stroke-local bbox; these are fractions of the sheet. Same name for two spaces
would be a trap.

**Anything reading a crit's nodes must skip `onNodeId` nodes.** They are marks
on a sheet, not content. `CritColumn` learned this the hard way: a callout is a
`sticky`, so before the guard it rendered on the desk card as a loose note torn
out of its picture.

**What this does NOT share with the 3D space.** LightboxModal's trace and
callouts are keyed to `boards.id` and their own API routes; none of that is
reused here. The two implementations now have to be kept in step by hand — if
callouts gain a feature in the lightbox, it does not appear in a crit.

---

## 9. OPEN — unfolded undo can read a stale board on very fast repeats

`handleUnfoldedUndo` builds its redo entry from `localBoards`, which is React
state and therefore one render behind an edit that has only just been applied
optimistically. Two Ctrl+Z presses inside a single frame can push a redo entry
describing the state *before* the first undo rather than after it, so redo
lands on the wrong value.

This is the same class of bug that `boardPositionsRef`'s eager write fixed
inside `useBoardState` (see §1's history), and the fix is the same shape: keep
a ref mirror of board position and size that is written synchronously at the
point of edit, and have `unfoldedMoveSnapshot` / `unfoldedSizeSnapshot` read
that instead of `localBoards`.

Narrow in practice — it needs two presses inside about 16ms, and a resize is a
mouse gesture whose undo is a single press — which is why it is written down
rather than fixed under time pressure. **Do not fix it by adding a delay.**

---

## 10. OPEN — the whole canvas UI is dead code

`/desk-crits/[id]` stopped mounting `InfiniteCanvas`; the space's canvas tab was
removed earlier. Nothing routable reaches any of it now:

- `components/canvas/InfiniteCanvas.tsx`
- `components/canvas/RoomCanvasPanel.tsx` (referenced by nothing at all)
- `components/canvas/CanvasToolbar.tsx`, `CanvasSelectionBar.tsx`
- `hooks/useCanvasHistory.ts`, `lib/canvas/history.ts`, `lib/canvas/arrange.ts`

**Do not delete blindly.** `components/canvas/CanvasNodeView.tsx` is still live
— `CritColumn` imports its `NodeProps` type — and the `canvas_nodes` table, its
API routes and `hooks/useCanvasNodes.ts` are all load-bearing for desk crits.
Only the drawing-surface UI above is unreachable. Left in place pending a call
on whether the canvas comes back.

---

## Accepted limits (working as intended — do not "fix" without reading why)

**Board deletion destroys the image bytes.** `/api/boards` DELETE cascades to
the storage objects. A deleted board can never be restored, which is why undo
for it is a 6-second window *before* the request rather than a restore after
it. See `DELETE_UNDO_WINDOW_MS` in `StudioRoom`. That route also has an
aliasing guard — copy/paste makes several boards share one storage object — and
its comment records that three boards were permanently destroyed before it
existed. Do not widen its storage removal.

**`scripts/cleanup-orphan-storage.ts` deletes anything it cannot prove is
referenced.** It reads four sources: `boards.*_url`, `canvas_nodes.props` image
nodes, `tables[].modelUrl` inside every nested wall-config JSON, and an
upload-age grace window. **Any new writer to the `board-images` bucket must add
a scan to that script in the same change.** Always dry-run first; never
`--apply` without a backup.

**Canvas undo is local and per-client.** It reverses what *you* did, never a
peer's edit. Because the canvas is last-write-wins per node, an undo is a new
write carrying an old value, not a rollback.

**Restoring a deleted canvas node re-attributes it to you.** The API stamps
authorship server-side and only guests may supply a name.

**Desk crits are private to their creator** — no members, no org, no guest
tokens, and deliberately no superadmin either. Personal-canvas requests use
`getVerifiedUser()` rather than `getSession()`, because there the uid is the
entire access check.

**The AI summary is rules, not a model.** `lib/summary/localSummary.ts` reads
the transcript with word lists and sentence heuristics — no API key, no
network, no cost. It picks salient sentences for the bullets and
imperative-looking ones for the next steps. **It does not understand the crit
and it will sometimes be wrong**, most often by summarising a sentence whose
meaning depended on something said three sentences earlier. Two guards exist
because they were needed: `isNegated` stops "you shouldn't add more programme"
becoming the task "Add more programme", and `NEGATED_INSTRUCTIONS` stops that
guard from swallowing "don't forget to…", which is a real instruction.
Swapping in a real provider means replacing `summariseLocally`; the callers,
the tables and the checkboxes are unchanged.

**`toSentences` must not use regex lookbehind.** `(?<=[.!?])` is a parse-time
SyntaxError on Safari and iOS below 16.4, and because it is a regex literal it
takes the whole module down at load rather than failing inside a try.

**Deleting a sheet in unfolded is the same permanent delete as in the 3D
room.** It destroys the row and the image bytes; the board does NOT return to
the `+` picker. The × is labelled and tooltipped to say so, and the keyboard
hint says "del to DELETE" rather than "remove", because "remove from wall" is
what people assume a developed-surface view does. Only the few-second window
gets it back.

**The unfolded key handler owns Ctrl+Z and Escape while that view is up.**
`StudioRoom`'s global keydown returns early on
`roomView === 'unfolded' && editingWall === null`. Both listeners are on
`window`, and `preventDefault` does not stop a sibling listener on the same
target — without the early return, one Ctrl+Z called `undoPendingDelete()`
twice and brought back two deleted boards.

**Unfolded editing keeps its own undo stack, separate from wall edit's.**
`useBoardState`'s stack records positions only — "where this board was", never
"which wall it was on" — because in 2D wall edit there is exactly one wall in
hand and the question cannot arise (`persistPositions` says so in a comment).
Unfolded shows every wall at once and its whole point is dragging a sheet from
one wall to another, so undoing through that stack would restore a board's x
and y while leaving it on the wall it was dragged to. `handleUnfoldedUndo` in
`StudioRoom` therefore replays from `unfoldedUndoRef`, which records the wall
alongside the position. **If you unify the two stacks, the wall has to come
with them.**

**Ctrl+Z does not un-add a board in unfolded.** Adding puts a board on a wall
it was not on before, so there is no earlier position to go back to and nothing
is pushed onto the move stack. Undoing an add would be a delete, which is a
different operation with its own 6-second window — use the sheet's × instead.

**Unfolded edit mode does not open the lightbox on click.** A click selects,
because the same press starts a drag. Turn Edit off to click through to a
board. Unfolded editing is also gated on `isWorkspaceMember`, the same flag the
wall-edit board tools use — a non-member is never shown the Edit toggle.

**Unfolded resize is width-led and preserves aspect.** A board is a physical
sheet; stretching one to an arbitrary rectangle would mean the drawing no
longer matches its printed proportions. It writes absolute inches via
`PATCH /api/boards/{id}/position`, not the position PUT — the legacy percentage
width/height fields on `position` are no longer read for size, so writing those
would look like it worked and then snap back on reload.

---

## Housekeeping

- The whole infinite-canvas surface is now **unreferenced**:
  `components/canvas/InfiniteCanvas.tsx`, `CanvasToolbar`, `CanvasNodeView`,
  `CanvasSelectionBar`, `RoomCanvasPanel`, `hooks/useRoomCanvas.ts`,
  `hooks/useCanvasHistory.ts`, `lib/canvas/arrange.ts`. Kept on purpose — the
  drawing tools are the natural basis for "Trace over" (§8), and `canvas_nodes`
  is still the live store for pinned work and notes, so migrations 036–038 are
  NOT dead. Do not delete the tables.
- `lib/summary/localSummary.ts` is a rule-based placeholder, not a model. It
  finds sentences that look like instructions. Replacing it with a real
  provider is one function; the callers, tables and checkboxes do not change.
- The presenter plumbing (`isPresenter`, follow mode, presence `isPresenting`)
  is still wired but **unreachable**: the Present button was removed and nothing
  else sets the flag. Either restore an entry point or remove the machinery.
- The presenter plumbing note above still stands.
- `docs/review-kova-system-ui.md` is an untracked read-only review of the
  `codex/kova-system-ui` branch — a Next 14→16 / React 18→19 upgrade entangled
  with a full redesign. Read it before merging that branch.
