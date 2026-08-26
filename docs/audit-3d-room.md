# How the 3D room is implemented

Read-only audit of the existing 3D studio room. Produced against `master`
(the audit was run from `feature/landing-redesign`, where the 3D code is
identical to `master` — only `app/page.tsx` differs).

## Scale

`components/3d/` is **10,220 lines** across 25 files, plus ~2,400 lines of studio route code. The five largest files are `StudioRoom.tsx` (2,493), `DraggableBoard.tsx` (1,555), `FloorEditorOverlay.tsx` (1,369), `useBoardState.ts` (1,198), and `boardSnapping.ts` (473).

## Stack and scene graph

React Three Fiber (`@react-three/fiber` 8) + `drei` on Three.js 0.160, all client-side. `app/studio/[id]/page.tsx` is the only surface that code-splits it (`dynamic(..., { ssr: false })` with a `webpackChunkName: "StudioRoom"` hint and a spinner fallback).

```
<Canvas shadows>
├── CameraController          orbit + animated fly-to-wall
├── PresenterCamBroadcast     presenter → followers (broadcast channel)
├── PresenterCursorBroadcast
├── LaserPointer
└── SceneContent
    ├── 7-light rig + <color attach="background">
    ├── WallSystem            floor + walls + BoardThumbnails + drei <Text> labels
    ├── TableWithModel[]      floor tables, optional 3D models
    ├── WallDropZone          only while dragging from sidebar
    └── DraggableBoard[]      only in edit mode, replaces thumbnails on that wall
```

Outside the Canvas: `RightCommentPanel`, `LightboxModal`, `FloorEditorOverlay`, `EditModeOverlay`.

## Coordinate system

Consistent and documented: **1 world unit = 1 inch**. Wall dimensions are authored in feet and multiplied by `SCALE = 12` (`lib/wallLayout.ts:77`). Walls are 6" thick, boards sit at ±3.2 (half-depth + 0.2 offset), text labels at ±3.25 so they never z-fight.

Board **positions** are stored as 0–100 percentages and converted to normalized −0.5…+0.5, so they're wall-relative and survive a wall resize. Board **sizes** are absolute inches via `getBoardSizeInches`, so resizing a wall deliberately does *not* stretch boards. Four layout algorithms exist (`zigzag`, `square`, `linear`, `lshape`) in `getWallTransform`, each overridable per-wall by `customTransforms`.

## Persistence

| Data | Where | Mechanism |
|---|---|---|
| Boards | `boards` table | REST via `/api/boards`, service-role + app-code access checks |
| Wall layout, tables, text labels | **JSON blob in the `board-images` storage bucket** at `wall-configs/{wsId}/{roomId}.json` | Optimistic concurrency via a `version` integer embedded in the blob |
| Textures | Supabase storage public URLs | `THREE.TextureLoader` |

The wall-config route is unusually well-reasoned: it distinguishes "blob absent" from "read failed" via `ConfigRead`, because conflating them once caused a client to seed defaults over a real layout and 409 the actual editor. Writes funnel through a single `useWallConfigWriter` gate that owns the base version and serializes all writers. The header comment openly accepts a "tiny read-then-write TOCTOU race for the pilot."

## Realtime

Four channels per studio session: boards `postgres_changes` (filtered `room_id=eq.X`), comments `postgres_changes`, `studio-presence:{roomId}`, and a `live` broadcast channel for presenter camera/cursor/lightbox sync. Board INSERT/UPDATE events deliberately trigger a **debounced refetch** (400ms) rather than mapping `payload.new` into state, because uploads INSERT a placeholder at 50/50 and PUT the real placement later.

Migration `030_realtime_select_rls.sql` already added the SELECT policies that `postgres_changes` needs — that hazard is handled.

---

# Findings, ranked

**1. The room is implemented five times.** `StudioRoom` is the *editor only*. `/studio/[id]/view`, `/crit/[token]`, `/share/[token]` and the two `/demo/studio/*` pages each build their own `<Canvas>`, lighting rig, `OrbitControls` config and camera math, reusing only leaf components (`WallSystem`, `TableWithModel`, `ModelViewer`). The duplication is hand-maintained and the code says so — `view/page.tsx` carries comments reading *"Match StudioRoom controls"*, *"Match StudioRoom camera layout and scaling logic"*, *"match StudioRoom for consistent brightness"*. The identical 7-light rig appears in 4 files; **demo has only 3 lights, so it already renders differently.** Any lighting or camera change needs 4–5 coordinated edits today.

**2. Board textures are never disposed.** `useBoardTexture.ts:22` holds a module-level `resolvedCache = new Map<string, THREE.Texture>()` with no eviction and no `dispose()` anywhere in the codebase for board textures. Every image viewed stays in GPU memory for the page lifetime, accumulating across room navigations. The cache is deliberate (it prevents a skeleton flash on the 3D↔2D toggle), so the fix is an LRU with disposal, not deletion. `PDFTexture`, `TableWithModel`, `WallConfigPreview` and `useDisposableGeometry` *do* dispose correctly — board textures are the gap.

**3. The Canvas renders continuously at full device resolution.** No `frameloop="demand"` and no `dpr` cap on any of the 8 `<Canvas>` mounts. On a 3× retina display that's ~9× the fragment cost of 1×, rendered every frame even when the scene is idle. With `shadows` + 2048² shadow maps + 7 lights, this is the most likely battery/thermal complaint source.

**4. `StudioRoom` is a god component.** 2,493 lines, 40+ props, 19 `useEffect`s, 22 `useCallback`s. To its credit the props are individually documented to an unusually high standard (the `canEditWalls` / `canDeleteWalls` / `canReorderBoards` distinctions are genuinely clear about *why* each permission is narrower than the last). But `SceneContent` receives `{...props}` plus 25 more explicit props, so the data flow is hard to trace.

**5. The comments realtime subscription has no filter.** `app/studio/[id]/page.tsx:633` subscribes to `{ event: '*', table: 'comments' }` with no `filter`, acknowledged in-code as *"comments doesn't carry workspace_id; panels filter client-side."* Every comment written anywhere in the product wakes every connected studio client to bump a nonce and refetch. Fine at pilot scale, quadratic-ish beyond it.

**6. Always-on production logging.** `postrace()` in `StudioRoom.tsx:8` and `useBoardState.ts` is explicitly *not* dev-gated — the comment says "TEMP diagnostic — always-on… Remove once root-caused." It logs on every `placedBoards3D` rebuild and every lightbox link read/write, with an ISO timestamp, in production.

**7. `DEFAULT_WALL_CONFIG` bypasses the layout algorithm.** `lib/wallLayout.ts:69` seeds new rooms with hand-tuned float `customTransforms` (`x: -43.90182462935905`). Since `getWallTransformResolved` prefers `customTransforms`, the `zigzag` branch of `getWallTransform` is dead code for every new room — it only runs for rooms that predate the override.

## What's genuinely well built

`boardSnapping.ts` is extracted as a pure, dependency-free module (smart guides, edge/center snapping, size matching, rotation-aware bounds) — testable and correctly separated from rendering. `DraggableBoard` pre-allocates its THREE vectors in refs to avoid per-frame allocation and drives drags through direct DOM pointer listeners rather than R3F events. `useBoardTexture` resolves real GPU max-anisotropy from a throwaway WebGL context and hands the context back immediately. `useDisposableGeometry` exists specifically because R3F doesn't dispose the intermediate geometry passed to `<edgesGeometry args={...}>` — a subtle leak someone found and fixed properly. The comment density around *why* decisions were made is well above average.
