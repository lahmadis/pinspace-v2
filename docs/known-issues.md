# Known issues

Real defects that are understood, reproducible, and deliberately not fixed yet.
Each entry names the file and line so the next person does not have to rediscover
it. Not a TODO list — things land here because someone decided the fix was out of
scope at the time, not because nobody has looked.

---

## Undo is local-only; the UI and database disagree after any undo

`components/3d/useBoardState.ts:395` — `applySnapshot`

Undo and redo restore React state (`setBoardPositions` + `setBoards`) and make no
API call. The database keeps whatever the mutation last persisted, so immediately
after Ctrl+Z the board is drawn in its old position while the server still holds
the new one. The two reconcile only when something else writes, or on reload —
which resurrects the position the user just undid.

Affects every undo in the 2D editor, not any one feature. Pre-existing;
predates the bulk-position path.

---

## `linewidth` is ignored by WebGL, so selected boards are outlined at 1px

`components/3d/DraggableBoard.tsx:1297` — `linewidth={isSelected ? 5 : 2}`

The WebGL renderer ignores `lineBasicMaterial.linewidth` in effectively every
browser; lines always rasterize at 1px. The value has no effect at either
setting. What actually distinguishes a selected board is the color change to
`#4444ff` and the second `lineSegments` overlay at
`components/3d/DraggableBoard.tsx:1302`.

Worth knowing before tuning selection feedback: raising the number will do
nothing. A thicker outline needs real geometry (a second offset outline, or a
line library that builds quads).
