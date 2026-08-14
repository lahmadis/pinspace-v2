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
- [x] Verified the current batch with 32 passing tests and a clean TypeScript check

## In Progress

- [ ] Stabilization Phase 2: investigate P2 storage lifecycle risks and harden core room/board flows

## Blocked

- [ ] Authenticated, RLS, storage, realtime, and multi-user testing — isolated Supabase URL and keys not configured
- [ ] Migration verification — no isolated Supabase project is connected; migrations must be applied manually in SQL Editor
- [ ] Board reorder release verification — apply `migrations/036_fix_board_reorder_text_ids.sql`, then verify the RPC signature and a real reorder
- [ ] Production-data alias audit — no source database URL and production access is intentionally out of scope

## Bugs Found

- P0: None confirmed; runtime coverage is incomplete
- P1 resolved in code: Privileged service-role routes now use verified identities
- P1 migration pending: Board reorder text-ID correction is committed but unapplied
- P1 resolved in code: Undo/redo now persists restored positions and reports failures
- P1: Production isolation and schema parity cannot be launch-verified without an isolated Supabase project
- P2: Duplicated boards alias storage objects
- P2: Room deletion leaks board storage objects
- P2: Orphan cleanup can race direct uploads when run with `--apply`
- P2 resolved in code: Room/workspace prefetch identifiers and cache failure behavior are corrected
- P2 partially resolved in code: 3D failures are contained and realtime lifecycle contracts are covered
- P2: 3D/realtime behavior still lacks production-like multi-client runtime evidence
- P2: Dependency advisories require reachability triage
- P3: Debug logs, legacy styling, inconsistent status UI, and existing lint warnings

## Decisions Needed

- Confirm that public institution domains and aggregate student counts are intended public data.
- Provide an isolated Supabase project when database, RLS, storage, realtime, and authenticated testing should begin.

## Next

- Configure an isolated Supabase project and apply/verify migration 036.
- Validate cross-institution RLS and storage behavior with representative roles.
- Audit storage alias/reference handling and room-deletion object lifecycle.
- Harden and test core room, board, upload, comments, sharing, and account flows.
- Run production-like 3D, texture-failure, reconnect, and presenter tests once the isolated backend is available.
