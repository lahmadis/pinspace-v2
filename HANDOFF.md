# PinSpace — Developer Handoff

For James and Charbel. Written against the repo as of commit `eba1012` (branch `master`).

You know React, Three.js and TypeScript. This document is only about the things
you cannot learn by reading the code: what is broken, what is dangerous, what is
already destroyed, and which conventions look wrong but are deliberate.

Read §2 and §3 before you write a line of code. There is **live pilot data with
real student work in production**, and this repo has already permanently
destroyed three boards' images through a code path that is only partially fixed.

---

## 1. What PinSpace is

PinSpace is a spatial portfolio and critique platform for architecture schools.
Instead of scrolling a flat grid of student work, faculty and students walk
through a **3D studio room** where student boards (drawings, sheets, PDFs) hang
on walls exactly as they would at a physical pin-up crit. Boards are uploaded,
placed on walls, moved/resized/rotated, commented on, and reviewed live during a
crit. There are also 2D wall editors, a lightbox slideshow, share links for
guests, an explore/network view across studios, and an admin surface for
provisioning studios and instructors.

It is currently in a **live pilot at Wentworth Institute of Technology (WIT)**.

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14, App Router, TypeScript |
| 3D | Three.js + React Three Fiber + drei |
| DB / Auth / Storage | Supabase (Postgres, Supabase Auth OTP + password fallback, Supabase Storage) |
| Styling | Tailwind CSS |
| Deploy | Vercel |
| Email | Resend |
| Errors | Sentry (`withSentryConfig`, tunnel route `/monitoring`) |
| Other | D3 (network layout), framer-motion, jszip, rhino3dm (`.3dm` models), browser-image-compression, react-markdown |

Env vars you need (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`PINSPACE_ADMIN_EMAILS`.

> **`README.md` is badly stale — do not trust it.** It describes a pre-database
> demo prototype with placeholder colored rectangles and sample data. That has
> not been true for a long time. `CLAUDE.md` and this file are the current
> sources of truth; `CONTEXT.md` is accurate but stops around Phase 4.

---

## 2. Data-loss bugs and dangerous areas

### 2.1 The storage aliasing bug — STILL PRESENT (by design, for now)

**`app/api/boards/duplicate/route.ts:116-117`**

```ts
thumbnail_url: source.thumbnail_url,
full_image_url: source.full_image_url,
```

Duplicating a board (copy/paste in wall-edit mode, which supports multi-board
paste) copies the source's storage **URLs verbatim**. It does not copy the
underlying storage object. So a source board, its copies, and sibling copies are
N database rows all pointing at **one** object in the `board-images` bucket.

Nothing in the DB records that this aliasing exists. There is no refcount, no
join table, no `storage_path` column — the only evidence an object is shared is
that two rows happen to contain the same URL.

Real storage copies (giving each duplicate its own object) were explicitly
deferred: *"Duplicate still aliases — real storage copies are phase 2"*
(commit `a3cbbc6`). **Phase 2 has not been done.** If you pick it up, that is
the correct permanent fix and it retires most of §2.2.

### 2.2 The unconditional delete — three boards already destroyed

Historically, `DELETE /api/boards` removed the board's storage object
unconditionally. Combined with §2.1, deleting **any** board in an alias group
permanently blanked every other board in that group — the rows survived,
pointing at an object that no longer existed. Per commit `691c53b`:

> *"The DELETE handler removed that object unconditionally, so deleting any
> board in an alias group permanently blanked the others — **three boards were
> already destroyed this way**."*

Those three images are **gone**. There is no backup path for them in this repo;
the storage object was deleted, not soft-deleted. The repo does not record which
three they were.

**Which boards are affected right now.** Any board that was ever duplicated is
in an alias group and is exposed to any future regression in the delete guard.
The repo cannot tell you which ones — you have to ask the database. These are
read-only queries; run them in the Supabase SQL Editor before touching any
delete path:

```sql
-- Alias groups: storage objects referenced by more than one board row.
-- Every row returned is a board that shares its image with another board.
SELECT full_image_url, count(*) AS refs, array_agg(id) AS board_ids,
       array_agg(DISTINCT workspace_id) AS workspaces
FROM boards
WHERE full_image_url IS NOT NULL AND full_image_url <> ''
GROUP BY full_image_url
HAVING count(*) > 1
ORDER BY refs DESC;

-- Candidate already-blanked boards: rows with no usable image.
SELECT id, workspace_id, room_id, title, owner_id, uploaded_at,
       thumbnail_url, full_image_url, upload_status
FROM boards
WHERE upload_status = 'complete'
  AND (full_image_url IS NULL OR full_image_url = '');
```

The second query finds rows that never got URLs. A board blanked by the old bug
still *has* a URL — it just 404s. Confirming those means fetching each URL, or
diffing `boards` URLs against a storage listing (`scripts/cleanup-orphan-storage.ts`
without `--apply` prints exactly the inverse: objects with no row).

**What the current guard does.** `app/api/boards/route.ts:590-755` now:

- checks whether any **other** board row references the object before removing it,
  keyed on the extracted **storage path**, not raw URL equality (URLs can differ
  by query string / encoding / CDN base and still address one object);
- checks `thumbnail_url` and `full_image_url` independently, each matched across
  **both** columns of other rows, de-duped for the PDF case where thumb == full;
- uses `supabaseServiceRole()` for the check on purpose — an RLS-bound query
  cannot see sibling rows in workspaces the deleter can't access, which would
  **under-count** references and delete a live object;
- deletes the **row first**, then removes storage, then re-checks each path
  immediately before removal (a concurrent `duplicate` can insert into that
  window);
- **fails safe everywhere**: any query error, any full candidate page, any
  ambiguity → skip removal, keep the object, still delete the row. An orphaned
  object is recoverable; a destroyed image is not.

**Do not "simplify" this function.** Every branch in it is a bug someone already
paid for. In particular do not: switch the reference check to `supabaseServer()`,
switch it back to raw-URL equality, move the storage removal back before the row
delete, remove the `CANDIDATE_LIMIT` full-page bailout, or make a storage failure
return 500.

The guard covers the **single-board delete path only**. It is not a general
solution — §2.1 is.

### 2.3 Other delete paths — know what each one does

| Path | Behavior | Risk |
|---|---|---|
| `DELETE /api/boards` (`app/api/boards/route.ts`) | Row + guarded storage removal | Guarded; see §2.2 |
| `PATCH /api/boards/reindex-after-wall-delete` | **Deletes every board row on a deleted wall**, then re-indexes higher walls | Rows are destroyed. Guarded by a binding `expectedBoardCount` (409 on mismatch) and owner/superadmin/instructor auth. Storage cleanup deliberately parked. |
| `DELETE /api/rooms/[id]` | Boards cascade-delete via the `boards.room_id` FK | **No storage cleanup at all** — orphans leak. Refuses to delete a workspace's last room. Does not blank aliases (it removes nothing from storage). |
| `scripts/cleanup-orphan-storage.ts --apply` | Deletes every bucket object not referenced by a board row or a wall-config `modelUrl` | **The most dangerous thing in the repo.** See below. |
| `DELETE /api/settings/delete-account` | Soft-delete only (`deleted_at = now()`) | Cascading hard-delete deferred post-pilot |

**About the cleanup script.** It is correct in its own terms, but it has a race:
the direct-upload path writes the storage object *before* the `boards` row
exists. Any object uploaded while the script is running looks unreferenced and
gets deleted. It also only reads the `boards` table and wall-config `modelUrl`s —
anything else that ever references a `board-images` object (a new feature, a new
column) becomes invisible to it and gets swept.

Per `CLAUDE.md`, **never run this or any cleanup script with `--apply` without
explicit confirmation from the project owner in the same session**, and never
without a recent backup. Run it without `--apply` (dry-run is the default) and
read the list first.

### 2.4 Undo is local-only — the UI and DB disagree after any undo

`components/3d/useBoardState.ts:395` (`applySnapshot`). Undo/redo restore React
state and make **no API call**. After Ctrl+Z the board renders in its old
position while the server still holds the new one; a reload resurrects the
position the user just undid. Affects every undo in the 2D editor. Known,
deliberately unfixed — see `docs/known-issues.md`.

### 2.5 The wall-config blob — versioned, and the concurrency is subtle

Room layout (walls, floor, tables, text items) is **not in Postgres**. It is a
JSON blob in the `board-images` bucket at `wall-configs/{workspaceId}/{roomId}.json`,
with a legacy fallback path `wall-configs/{workspaceId}.json`.

It uses optimistic concurrency: the blob carries an integer `version`, clients
send the `baseVersion` they read, the server 409s on mismatch. `lib/wallConfigWriter.ts`
owns the version **and** a serialization queue — at most one POST in flight, and
each write reads the version only when it reaches the front of the queue, so two
writes can never carry the same `baseVersion`. On a surviving 409 it decides
between **rebase** (same user overlapping with themselves — two tabs) and
**report** (a genuinely different editor — reload + toast, never silently
clobber) by comparing the blob's stamped `lastWriterId`. Absent id fails safe
into "report".

Four call sites write this blob (debounced autosave, Save & Exit, wall-delete
persist, text-item save). If you add a fifth, route it through
`lib/wallConfigWriter.ts` — do not POST the route directly.

A failed *read* deliberately returns **no** `version` field, because a client
that reads `version: 0` from a transient error will happily seed defaults over a
room that already has a real layout. Preserve that distinction.

### 2.6 Live pilot data

- The **WIT pilot is live**. `workspaces`, `rooms`, `boards` and storage contain
  real student work. Treat production as production.
- Studios are **provisioned by an admin for professors** rather than created
  organically. `workspaces.created_by_admin` (migration 033) records that
  provenance; `lib/workspaces/createWorkspace.ts` keeps pilot studios
  distinguishable from organic ones. Admin surfaces:
  `app/api/admin/studios/*`, `app/api/admin/instructors/*`, `app/admin/page.tsx`.
- An admin gets upload access to a pilot studio by being added as a **member**
  (`app/api/admin/studios/[id]/membership/route.ts`), not by a role escalation.
- Explore/network is scoped **strictly to the signed-in user's own institution**
  for the pilot; any `institution_slug` / `institution_id` query params are
  deliberately ignored (`app/api/explore/studios/route.ts`). Don't "fix" that
  into a global network — it was removed on purpose (migration 016).
- Several things are consciously "good enough for the pilot" and commented as
  such: the wall-config read-then-write TOCTOU race, upload filename collision
  probability, toast ordering under parallel PDF uploads. Don't treat those
  comments as bugs to fix without asking.

---

## 3. Hard rules

These come from `CLAUDE.md` and are non-negotiable. They exist because each one
already cost someone a day.

1. **NEVER run `npm run build` locally.** It hangs the Windows session. Push and
   let Vercel build. Same for `next lint` — skip it, it hangs.
2. **`npx tsc --noEmit` is the type check**, run in the foreground. That's it.
3. **Migrations are never auto-applied.** Files in `migrations/` are committed to
   git but must be **manually pasted into the Supabase SQL Editor** and run.
   Migration method is SQL Editor paste — *not* the Supabase CLI, *not*
   `supabase db push`.
4. **A phase is not shipped until its migration is applied AND verified.** Verify
   with an `information_schema` check, never by assumption:
   ```sql
   SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'boards' AND column_name = 'sort_order');
   ```
   A code/migration mismatch produces **silent runtime failures, not type
   errors** — `tsc` passes either way. This has bitten this project hard: on
   2026-05-08, migrations 011–015 were found unapplied *behind a phase marked
   shipped*, causing 500s on rotation, 404s on workspaces, and a "rooms does not
   exist" relation error. See the Incident Log in `CONTEXT.md`.
5. **Write migrations idempotently** — `ADD COLUMN IF NOT EXISTS`,
   `CREATE TABLE IF NOT EXISTS`, `IF NOT EXISTS` on indexes, `DROP POLICY IF EXISTS`
   before `CREATE POLICY` — so re-running is safe when applied-status is
   uncertain. Some have already been hand-applied to production before the file
   existed (migration 035 says so explicitly), so a migration that isn't a safe
   no-op will fail against prod.
6. **Any migration creating a table subscribed via `postgres_changes` must
   include `ALTER PUBLICATION supabase_realtime ADD TABLE` in the same file.**
7. **Run a read-only diagnostic pass before implementing anything** on a
   save-path, state-sync, data-integrity or architectural surface. Look before
   you touch: enumerate the call sites, write down the current behavior, *then*
   plan. `docs/storage-audit-P1.md` and `audits/codebase-audit-2026-05-12.md` are
   what that output looks like.
8. **Never run destructive/cleanup scripts with `--apply`** without explicit
   confirmation in the same session.
9. Work **one phase at a time**. Smoke-test in the browser before pushing schema
   changes. Don't push between commits inside a phase — push the batch at the end.
10. **The project path contains spaces.** Always quote it in shell commands.

If any single command or step runs longer than ~2 minutes, stop and report
rather than letting it hang.

---

## 4. Codebase gotchas

These are the things that will burn you specifically because they look like
mistakes.

### 4.1 `boards.id` is TEXT, not a UUID

```sql
id TEXT PRIMARY KEY   -- migrations/archive/CLEAN_SETUP_boards_table.sql:10
```

Board IDs are generated in application code as **`board-{timestamp}-{random}`**:

```ts
const boardId = `board-${ts}-${rand}`                                  // app/api/boards/route.ts:944
const newId = `board-${timestamp}-${Math.random().toString(36).slice(2, 8)}` // duplicate/route.ts:95
```

Timestamp alone is **not** unique — multi-board paste fires one request per board
and several land in the same millisecond, which collided on the primary key and
500'd. Both insert paths must keep the same shape; if you add a third, match it.

`rooms.id`, `workspaces.id` and `organizations.id` **are** real UUIDs. Don't
assume uniformity in either direction.

### 4.2 A non-UUID in a UUID comparison fails the whole statement

This is the sharp edge behind the type mix. Postgres raises `22P02` (invalid text
representation) on a malformed UUID, and that **fails the entire statement** — it
does not just miss the row. An `.in()` batch containing one bad id returns *no*
rows, so a single legacy/seeded value blanks an entire admin table.

That's why you'll see `isUuid()` filters everywhere before a UUID query:

```ts
import { isUuid } from '@/lib/validation/uuid'
const ownerIds = Array.from(new Set(rows.map(w => w.owner_id))).filter(isUuid)
// app/api/admin/studios/route.ts:53 — an unfiltered non-UUID owner_id would
// 22P02 and blank the owner column for EVERY studio.
```

Filter before you query, and reject malformed path segments with a 400/404 rather
than letting them reach the DB.

### 4.3 `owner_id` is text; `user_profiles.user_id` is uuid — casts required

`workspaces.owner_id TEXT`, `boards.owner_id TEXT`, `workspace_members.user_id TEXT`
— all of them store the Supabase user id as text, to match `auth.uid()::text` in
the RLS policies. `user_profiles.user_id` is a real `uuid`.

Any join or comparison between them needs a `::text` cast. In SQL:

```sql
WHERE w.owner_id = auth.uid()::text          -- migrations/030_realtime_select_rls.sql:80
```

In TypeScript you're comparing strings, so it usually just works — but the
moment you write raw SQL, an RPC, or a policy, the cast is mandatory. This is
check #3 in the pre-push reviewer for a reason.

### 4.4 The service-role + app-check pattern is intentional — do not add RLS policies

**Do not add new RLS policies.** For any read that involves a
joined-but-not-owned workspace, the project standard is:

```ts
const admin = supabaseServiceRole()   // bypasses RLS
// ...then enforce access in app code: owner OR member OR org OR public
```

`supabaseServer()` is the cookie-session client and **RLS applies** — on
`workspaces`, `rooms`, `boards` and `workspace_members` it will **silently filter
out** rows the user doesn't own. Silently: no error, just a short result set.
That's how you get "the board vanished for collaborators" bugs. It is also
exactly the failure mode that makes an under-counted alias check delete a live
image (§2.2).

So: reads on those four tables go through `supabaseServiceRole()` with an
explicit access check in app code. Membership is checked inline per route (there
is deliberately **no** shared `isWorkspaceMember` helper yet — if you add one,
port all the existing call sites, don't leave two conventions). The canonical
shape, owner first because **`workspace_members` does not contain the owner**:

```ts
const { data: ws } = await admin.from('workspaces').select('owner_id').eq('id', id).maybeSingle()
if (!ws) return 404
if (ws.owner_id !== userId) {
  const { data: m } = await admin.from('workspace_members')
    .select('user_id').eq('workspace_id', id).eq('user_id', userId).maybeSingle()
  if (!m) return 403
}
```

`workspace_members` has **no `role` column** — membership is binary, row exists =
member.

**The one exception**, and understand why before you touch it: migration 030 adds
**SELECT-only** RLS policies to `boards`, `comments`, `board_comments` and
`board_traces`. Supabase Realtime evaluates each table's SELECT policies as the
*subscribing user*, and silently drops changed rows the user can't SELECT — so
members of a shared workspace were getting **no** `postgres_changes` events and
only saw new boards after a refresh (which goes through the service-role route
and bypasses RLS). Those policies exist to make realtime delivery work. They are
defense-in-depth **added for realtime**, they do **not** replace the service-role
pattern, and they are SELECT-only — no INSERT/UPDATE/DELETE policies were added
and none should be.

### 4.5 `useSearchParams` needs a `<Suspense>` boundary — and only Vercel tells you

Any client component calling `useSearchParams` must have a `<Suspense>` boundary
up its tree. Missing it fails **only at Vercel build time** — `tsc` and lint both
pass. This is the single most common way to break the deploy.

### 4.6 Route naming lies: `/api/studios/[id]/...` takes a *workspace* id

`app/api/studios/[id]/wall-config/route.ts` — the `[id]` param is the
**workspace id**, not a studio/room id. Every caller confirms it
(`const wsKey = workspaceId ?? studioId`). Relatedly, the `Board` API shape
carries `studioId` as a **backward-compat alias for `workspaceId`** — same value,
two field names. Don't try to reconcile them without checking every consumer.

### 4.7 Rooms and sub-rooms

Sub-rooms are shipped. A **parent room is a folder/container with no 3D space**;
the **sub-rooms inside it are the actual 3D studios**. The ownership chain is
`workspaces.id` ← `rooms.workspace_id` ← `boards.room_id`.

`lib/rooms.ts` (`resolveFirstRoomId` / `resolveMainRoomId`) resolves a
workspace's default room by `display_order ASC, created_at ASC` — **not** by
`name = 'Main Room'`, which broke silently when instructors renamed it
(renaming is explicitly allowed). Every board must have a `room_id`.

### 4.8 Board placement vs. slideshow order

Two different orderings, easy to conflate:

- **Placement in the 3D room is entirely position-derived** — `WallSystem`
  selects by `position_wall_index` and computes coordinates from
  `position_x` / `position_y` / `position_side`. Positions are percentages 0–100
  of the wall (50,50 = center); `position_rotation` is radians applied as
  `rotation.z`.
- **`boards.sort_order`** (migration 035) drives **only** the lightbox
  prev/next sequence and its counter (`lib/boardOrder.ts`). It has nothing to do
  with placement. The APIs still return `uploaded_at DESC` and the client
  re-sorts for the lightbox.

### 4.9 Board position writes are serialized per board

`lib/boardPositionWriteQueue.ts`. Move (PUT) and resize (PATCH) previously fired
overlapping unsequenced requests for the same board, so rapid edits committed out
of order — the DB settled on whichever request *finished* last, not the one
*issued* last. Writes are now chained per board id; different boards stay
parallel. The chain doesn't swallow results, and a failed write doesn't wedge it.
Route new position writes through it.

### 4.10 Uploads go client-direct to storage now

`lib/useDirectUpload.ts` uploads to the `board-images` bucket from the browser,
then `POST /api/boards` writes the metadata row. The old server-proxied
`/api/upload` route was retired (it was capped by Vercel's ~4.5 MB request body
limit while claiming to accept 50 MB). Client-side compression is
`browser-image-compression`; PDFs and `.ai` files are rasterized client-side
(`lib/pdfToImage.ts`).

Storage paths: `{userId}/{timestamp}-{random}.jpg` and `-thumb.jpg`; models at
`{userId}/models/...`; wall configs at `wall-configs/...`. Storage RLS
(migration 021) requires the first path segment to equal the uploader's uid — a
path that doesn't start with `{userId}/` will be rejected.

The `boards` row uses a **pending → complete** pattern (`upload_status`); the
boards GET filters out `pending` rows so realtime subscribers never see
empty-URL boards.

### 4.11 Department lists

Import from `lib/constants/departments.ts`. Never define a local copy. (Pre-push
check #4.)

### 4.12 Dead code that looks alive

Per `audits/codebase-audit-2026-05-12.md`, ~1,870 lines of components have no
importers — notably `components/WallCanvasEditor.tsx` (748 lines, mounted
**nowhere**, confirmed by exhaustive grep), plus `Wall.tsx`, `CritModeHeader.tsx`,
`InstitutionCard.tsx`, `PinModeHeader.tsx`, `PublishCategoryModal.tsx`,
`PublishConfirmModal.tsx`, `QuickNotePanel.tsx`, `SideCommentPanel.tsx`.

Don't spend time fixing bugs in them, and check `git log` before deleting them.
Note that grep alone gives false positives: `components/3d/StudioRoom.tsx` is
loaded via `dynamic(() => import(...))` and `components/3d/setupDraco.ts` is a
side-effect import — both are very much alive.

### 4.13 Deprecated columns still load-bearing

`is_public` is marked deprecated (migration 016) but is **still read** by the
published-workspace check, paired with `published_at`, in ~11 routes. Removing
references breaks "published" detection. `network_metadata` was never scheduled
for removal and is live in six routes. Neither is safe to clean up casually.

---

## 5. Working in this repo

### Getting started

```bash
npm install          # postinstall copies rhino3dm wasm into public/wasm
npm run dev          # scripts/dev-safe-start.js — frees port 3000, clears .next caches
npx tsc --noEmit     # the type check
```

`npm run dev` deliberately goes through `dev-safe-start.js`, which kills whatever
is listening on the port and clears stale Next caches (a Windows quality-of-life
thing). `npm run dev:raw` is the plain `next dev` if you need it.

### Before every commit

Run the **pre-push reviewer** (`.claude/agents/pre-push-reviewer.md`) over the
changed files, or check its five items by hand:

1. `useSearchParams` without a `<Suspense>` boundary (fails only on Vercel).
2. `supabaseServer()` reads on `workspaces` / `rooms` / `boards` /
   `workspace_members` — the RLS silent-filter trap.
3. `owner_id` (text) vs `user_profiles.user_id` (uuid) compared without `::text`.
4. A locally-defined department array instead of the shared constant.
5. New `migrations/` files: realtime publication line present if needed, and end
   the report with **`MIGRATION REQUIRED: apply migrations/<file> to Supabase
   before testing. Phase is not shipped until migration applied.`**

Then stage, commit, push. Let Vercel build.

### Where things live

| Area | Path |
|---|---|
| 3D studio room | `components/3d/` — `StudioRoom.tsx` (2.5k), `DraggableBoard.tsx`, `useBoardState.ts`, `FloorEditorOverlay.tsx`, `boardSnapping.ts` |
| Lightbox / slideshow | `components/LightboxModal.tsx` (3.2k lines — the largest file) |
| Board API | `app/api/boards/` — `route.ts`, `duplicate/`, `reorder/`, `reindex-after-wall-delete/` |
| Wall config | `app/api/studios/[id]/wall-config/route.ts` + `lib/wallConfigWriter.ts` |
| Studio pages | `app/studio/[id]/page.tsx` (edit), `app/studio/[id]/view/page.tsx` (view-only) |
| Guest / share | `app/share/[token]/`, `app/crit/[token]/` |
| Admin | `app/admin/page.tsx`, `app/api/admin/` |
| Supabase clients | `lib/supabase/server.ts` — `supabaseServer()` vs `supabaseServiceRole()` |
| Migrations | `migrations/001`–`035`, plus `migrations/archive/` (historical, never re-run) |

### Docs worth reading, and how much to trust them

| Doc | Trust |
|---|---|
| `CLAUDE.md` | **Current.** The hard rules. |
| `docs/known-issues.md` | **Current.** Real, understood, deliberately-unfixed defects. |
| `CONTEXT.md` | Accurate but stops around Phase 4. Incident log and migration discipline still apply. |
| `audits/codebase-audit-2026-05-12.md` | Point-in-time, read-only sweep. Still broadly right. |
| `docs/storage-audit-P1.md` | Detailed but **partly stale** — e.g. it says the wall-config POST has no auth guard; it does now (owner-or-member, `route.ts:190-199`), and `/api/upload` has since been retired. Verify against code before acting on it. |
| `README.md` | **Stale — ignore.** Describes the pre-database demo. |
| `docs/archive/` | Historical only. |

### Judgment calls the codebase has already made

Written down because they look like bugs and aren't:

- Skipping a storage removal on *any* uncertainty (leak instead of lose).
- Deleting the row even when storage cleanup fails (the caller's delete
  succeeded; reporting 500 invites a retry of a completed delete).
- Service-role reads with app-level access checks instead of RLS policies.
- SELECT-only RLS policies added *solely* so realtime reaches members.
- Owner checked before `workspace_members`, always — owners have no member row.
- `isUuid()` filtering before any UUID query.
- Rebase-vs-report on wall-config 409s, decided by `lastWriterId`.

When you change one of these, you're changing a decision, not fixing an
oversight. Say so in the commit message — the git history here is unusually
detailed about *why*, and it's the best documentation in the project. Read
`git log` on a file before rewriting it.
