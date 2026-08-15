# PinSpace Initial Launch-Readiness Audit

**Date:** 2026-08-14

**Scope:** Static repository review, dependency/setup baseline, TypeScript/build baseline, architecture mapping, and initial security/data-integrity review.

**Status:** Initial deliverable only. Authenticated Supabase, storage, realtime, RLS, multi-user, browser, and production behavior remain unverified because no isolated Supabase environment is configured.

## Executive summary

PinSpace is a mature live-pilot application with substantial safeguards around board persistence, room membership, wall-config concurrency, and realtime cleanup. It is not currently launch-verified. No P0 crash or active cross-tenant exposure has been reproduced yet, but three P1 issues are supported directly by source: privileged routes that trust a locally read session before service-role operations, a board-reorder SQL type mismatch that makes the feature fail for real board IDs, and undo/redo that changes the UI without persisting the restored position.

The safest execution order is security identity hardening, board/data consistency, isolated Supabase verification, 3D/realtime diagnostics, and only then targeted Kova styling. The previously proposed full UI replacement is superseded by the master prompt's stabilization-first and no-rebuild guardrails.

## A. Architecture summary

### Frontend and routing

- Next.js 14 App Router with React 18 and TypeScript.
- Route groups cover public landing/authentication, dashboard/workspaces, discovery/network/gallery, studio/viewer, share/critique links, settings, and platform administration.
- Client-heavy pages own most interaction state; `app/studio/[id]/page.tsx` coordinates room loading, Supabase channels, presenter/follower state, and the `StudioRoom` 3D surface.
- Tailwind CSS provides styling. The Kova palette and Figtree/JetBrains Mono foundation now exists on the isolated redesign branch, but route migration is paused pending stabilization.

### Authentication and authorization

- Browser and request-scoped Supabase clients use the public URL and anon key with auth cookies.
- Middleware checks only for the presence of a Supabase auth cookie and provides UX redirects; API routes are expected to enforce real authorization.
- `getVerifiedUser()` uses `auth.getUser()` for server-verified identity, and `requireAdmin()` combines it with the `PINSPACE_ADMIN_EMAILS` allowlist.
- Authorization is otherwise implemented per route: workspace owner, membership, organization, public publication, guest token, or platform-admin checks.
- Service-role clients bypass RLS and therefore depend entirely on correct application-level checks.

### Supabase data and multi-tenancy

- Core tables include organizations, organization domains/requests, user profiles, workspaces, workspace membership, rooms, boards, comments, critique records, and feedback.
- Organization access is derived from the authenticated profile or membership rather than trusting a client-supplied organization ID on the hardened exploration paths.
- SQL migrations are committed but applied manually through the Supabase SQL Editor. The repository cannot prove which migrations or policies are active in a live project.
- RLS is present in migrations, but production parity and cross-institution isolation require an isolated database with at least two institutions and representative roles.

### Rooms, boards, and storage

- Workspaces contain rooms; boards retain `workspace_id` and also reference `room_id`.
- Board images and wall configuration live in the public `board-images` bucket. Board metadata and positions live in Postgres.
- Board upload is browser-to-Supabase Storage followed by metadata creation through the application API.
- Wall layout is a versioned JSON object at a room-scoped storage path. `wallConfigWriter` serializes writes and handles version conflicts.
- Duplicated boards currently share the same underlying image URLs. Single-board deletion has a defensive reference check; room cascades leave storage objects orphaned.

### 3D rendering and persistence

- React Three Fiber and drei render rooms through `StudioRoom`, `WallSystem`, `DraggableBoard`, `CameraController`, model/table components, and editing overlays.
- Boards use normalized wall positions in the client and persist transformed values through API write queues.
- Texture hooks retain the previous texture while a replacement loads, and several geometry/material paths explicitly dispose resources.
- Multiple `useFrame` loops support camera motion, presenter broadcast, laser/pointer behavior, thumbnails, gallery interaction, and model presentation. Runtime profiling is still required.

### Realtime and presentation

- Per-room `postgres_changes` channels synchronize boards; workspace-level channels synchronize comments.
- Per-room presence channels track participants, active editor walls, and presenter state.
- Per-room broadcast channels carry presenter camera pose, pointer/laser data, lightbox navigation, trace points, and dirty notifications for guests without database-change access.
- Reviewed channel effects generally call `removeChannel()` during cleanup, but reconnection, duplicate subscription, stale presence, and 25-user behavior remain runtime test items.

### Deployment and observability

- Vercel remains the intended deployment platform.
- Sentry is configured with source maps and a `/monitoring` tunnel excluded from middleware.
- Local TypeScript passes. A local production build completed in this environment but logged missing Supabase configuration and existing lint warnings; repository guidance now limits routine local verification to foreground `npx tsc --noEmit`, with preview builds delegated to Vercel.

## B. Prioritized bug and risk list

### P0 — Launch blocker

- No P0 has been confirmed by this static pass. This is not proof that none exists; authenticated, production-like, 3D, realtime, and cross-tenant testing has not run.

### P1 — Critical

#### P1-01 — Privileged service-role routes rely on an unverified session object

`app/api/admin/overview/route.ts:10-23`, `app/api/admin/institutions/[slug]/stats/route.ts:16-29`, and `app/api/institutions/route.ts:68-100` call `auth.getSession()`, trust `session.user.email`, and then issue service-role reads or writes. Sibling institution/domain/stats/debug routes use the same pattern. Supabase server guidance treats `getSession()` data as unsuitable for authorization because it may be read from local cookie state without revalidating the user with the auth server. The repository already contains the correct `getVerifiedUser()` / `requireAdmin()` pattern.

**Impact:** If an attacker can supply accepted local session claims, they may reach cross-tenant administrative reads or writes that bypass RLS.

**Fix direction:** Replace all privileged gates with `requireAdmin()` or `getVerifiedUser()`, then add forged/expired-session and non-admin tests before touching adjacent behavior.

#### P1-02 — Board reorder RPC is incompatible with real board IDs

`migrations/035_board_sort_order.sql:87-100` declares `p_ids uuid[]` and joins UUID values against `boards.id`. The authoritative board schema uses a text primary key, and `app/api/boards/route.ts:942-964` creates IDs such as `board-<timestamp>-<suffix>`, which cannot be cast to UUID. The API's `reorder_room_boards` call therefore fails for real uploaded boards even when authorization succeeds.

**Impact:** Workspace owners cannot reliably reorder presentation boards; the route returns 500.

**Fix direction:** Add a new idempotent migration replacing the function with `p_ids text[]`, preserve the service-role-only grant, add contract tests, and require manual migration verification before marking fixed.

#### P1-03 — Undo/redo restores only local React state

`components/3d/useBoardState.ts:395-413` applies an undo snapshot with `setBoardPositions` and `setBoards` but performs no persistence call. Reloading or re-entering restores the server's newer position and reverses the user's undo.

**Impact:** The visible editor state can disagree with persisted room state, causing apparent data loss and multi-user inconsistency.

**Fix direction:** Diagnostic pass first, then queue an atomic bulk position write for restored snapshots, handle partial failure explicitly, and test save/leave/refresh/rejoin/second-user behavior.

#### P1-04 — Production security and data isolation cannot be verified without an isolated Supabase project

The worktree has no usable Supabase environment or source database URL. Static source and migrations do not prove active production schema, RLS, bucket policies, realtime publication, or migration parity.

**Impact:** Launch readiness, cross-institution isolation, uploads, realtime, and destructive behavior cannot be responsibly certified.

**Resolution:** Configure an isolated Supabase project with non-production data, apply and verify migrations manually, and create representative student/faculty/admin accounts across two institutions.

### P2 — Important

#### P2-01 — Duplicated boards alias the same storage objects

`app/api/boards/duplicate/route.ts:108-117` copies the source thumbnail and full-image URLs instead of copying storage objects. Current single-board deletion guards shared references, so no active unguarded blanking path was confirmed. The design remains fragile and makes cleanup concurrency-sensitive.

#### P2-02 — Room deletion leaks storage objects

Deleting a room cascades board rows but performs no corresponding image cleanup. This avoids destroying aliased images but accumulates orphaned storage and complicates retention/account deletion.

#### P2-03 — Cleanup can race active direct uploads

The orphan cleanup script can see a just-uploaded object before its board row exists. Its default dry-run is safe, but `--apply` during uploads could delete valid objects. Keep explicit approval, backup, and a maintenance window mandatory.

#### P2-04 — Studio prefetch requests wall config with a room ID where a workspace ID is expected

`lib/studioViewCache.ts:66-84` documents that its wall-config prefetch falls back to defaults until the view page resolves the workspace. This wastes a request and can create a visible default-to-real layout transition.

#### P2-05 — 3D/realtime launch claims lack runtime evidence

The code contains cleanup and disposal mechanisms, but blank-canvas recovery, asset-failure isolation, reconnection, stale presence, presenter handoff, WebGL variance, memory growth, and common-laptop frame rate have not been tested. Treat these as required diagnostic work, not fixed features.

#### P2-06 — Automated coverage is minimal and environment-blocked

The new branch has token tests and browser-test scaffolding, but core API authorization, board persistence, uploads, RLS, realtime, and 3D flows do not yet have executable coverage. Browser binaries and test accounts also require setup.

#### P2-07 — Dependency audit requires triage

Dependency installation reported 26 advisories, including one critical, but affected runtime paths and production reachability have not yet been established. Do not run a forced upgrade; capture `npm audit --json`, classify direct versus transitive packages, and upgrade surgically.

**Resolved in code (2026-08-14):** Upgraded surgically to Next.js 16.3.1, Sentry 10.70, Vitest 3.2, PostCSS 8.5, and ESLint 9; migrated async request APIs and proxy conventions; then applied non-breaking transitive fixes. `npm audit` now reports zero known vulnerabilities.

### P3 — Polish

- Debug logging remains in PDF, gallery, wall-drop, board-state, and studio paths; several logs can be noisy in interaction-heavy flows.
- Styling contains widespread legacy indigo/gray literals and inconsistent loading/error components.
- Build lint output contains existing hook-dependency and raw-image warnings.
- The fixed-layout Kova reference needs adaptation for common laptop widths rather than direct code reuse.

## Immediate execution order

1. Add authorization regression tests and replace privileged `getSession()` gates.
2. Add a failing board-reorder contract test, prepare the `text[]` migration, and wait for manual Supabase application/verification.
3. Diagnose undo persistence and implement the smallest queued persistence fix with rollback/error behavior.
4. Configure the isolated Supabase test project and verify schema, RLS, storage, and role separation.
5. Run focused 3D/realtime diagnostics before performance changes.
6. Apply targeted Kova UI cleanup only after P0/P1 work is green.

## Verification limitations

- No production database or storage was accessed.
- No destructive scripts or migrations were run.
- No authenticated browser journeys were executed.
- No multi-user, WebGL/browser matrix, load, Vercel preview, or production deployment verification was performed.
- The standard independent security worker was unavailable under the current no-subagent constraint; findings were validated sequentially from local source and should receive a second review before release.
