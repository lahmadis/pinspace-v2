# PinSpace Stabilization Status

## Completed

- [x] Created isolated global worktree on `codex/kova-system-ui`
- [x] Installed locked dependencies and captured TypeScript/build baseline
- [x] Inventoried application routes and user-visible states
- [x] Mapped authentication, Supabase, rooms, boards, storage, realtime, 3D, and deployment architecture
- [x] Produced initial P0/P1/P2/P3 launch-readiness report
- [x] Produced initial security best-practices report
- [x] Established Kova design tokens and basic test scaffolding before the stabilization master prompt superseded the rollout order
- [x] Replaced unverified privileged-route sessions with the verified `requireAdmin()` boundary
- [x] Prepared and contract-tested the text-ID board reorder migration
- [x] Persisted undo/redo snapshots through the serialized board write queue
- [x] Corrected explore prefetching to use room IDs for boards and workspace IDs for wall configuration
- [x] Prevented failed board prefetches and placeholder wall layouts from poisoning the viewer cache
- [x] Added accessible crash containment and retry states around all critical 3D canvases
- [x] Hardened member and guest realtime cleanup against stale channel/ref teardown
- [x] Verified storage-critical board and room routes against GoTrue before service-role work
- [x] Made new duplicated boards copy their storage objects with rollback on failure
- [x] Enforced verified-user storage paths and rejected already-attached direct-upload objects
- [x] Added fail-safe, paginated storage cleanup to room deletion
- [x] Added a 24-hour age floor, pagination, and per-batch reference rechecks to orphan cleanup
- [x] Replaced unverified session payloads across every service-role API route with GoTrue-verified users
- [x] Added a repository-wide contract that rejects future service-role plus `getSession()` combinations
- [x] Added fail-safe workspace deletion cleanup for board media, wall configs, and unreferenced 3D models
- [x] Upgraded from Next.js 14 to 16.3.1 and migrated every server cookie and dynamic route parameter boundary
- [x] Replaced the removed `next lint` command with an ESLint 9 flat configuration and cleared all blocking lint errors
- [x] Reduced the dependency audit from 26 advisories (one critical) to zero known vulnerabilities
- [x] Verified the current code with 47 passing tests, a clean TypeScript check, a clean blocking-error lint check, and a Next.js 16 HTTP 200 smoke test

## In Progress

- [ ] Stabilization Phase 3: harden remaining core room, board, comments, sharing, and account failure paths

## Blocked

- [ ] Authenticated, RLS, storage, realtime, and multi-user testing — isolated Supabase URL and keys not configured
- [ ] Migration verification — no isolated Supabase project is connected; migrations must be applied manually in SQL Editor
- [ ] Board reorder release verification — apply `migrations/036_fix_board_reorder_text_ids.sql`, then verify the RPC signature and a real reorder
- [ ] Production-data alias audit — no source database URL and production access is intentionally out of scope

## Bugs Found

- P0: None confirmed; runtime coverage is incomplete
- P1 resolved in code: Privileged service-role routes now use verified identities
- P1 resolved in code: All remaining service-role API routes now use verified identities
- P1 migration pending: Board reorder text-ID correction is committed but unapplied
- P1 resolved in code: Undo/redo now persists restored positions and reports failures
- P1: Production isolation and schema parity cannot be launch-verified without an isolated Supabase project
- P2 partially resolved in code: New duplicates own independent objects; legacy aliased rows remain guarded and require a data audit
- P2 resolved in code: Room deletion removes only objects proven unreferenced after cascade
- P2 resolved in code: Workspace deletion cleans board media, wall configs, and models without removing surviving references
- P2 mitigated in code: Orphan cleanup protects recent uploads and rechecks references; `--apply` remains a manual high-impact operation
- P2 resolved in code: Room/workspace prefetch identifiers and cache failure behavior are corrected
- P2 partially resolved in code: 3D failures are contained and realtime lifecycle contracts are covered
- P2: 3D/realtime behavior still lacks production-like multi-client runtime evidence
- P2 resolved in code: Dependency audit reports zero known vulnerabilities after the supported Next.js 16 migration
- P3: Debug logs, legacy styling, inconsistent status UI, hook dependency warnings, raw-image warnings, and React Compiler-readiness warnings

## Decisions Needed

- Confirm that public institution domains and aggregate student counts are intended public data.
- Provide an isolated Supabase project when database, RLS, storage, realtime, and authenticated testing should begin.

## Next

- Configure an isolated Supabase project and apply/verify migration 036.
- Validate cross-institution RLS and storage behavior with representative roles.
- Harden and contract-test the remaining comments, sharing, and account failure paths.
- Complete the Kova route-group migration and shared state treatment.
- Reduce the remaining non-blocking lint warnings while migrating each affected UI surface.
- Run production-like 3D, texture-failure, reconnect, and presenter tests once the isolated backend is available.
