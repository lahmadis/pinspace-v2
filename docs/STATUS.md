# PinSpace Stabilization Status

## Completed

- [x] Created isolated global worktree on `codex/kova-system-ui`
- [x] Installed locked dependencies and captured TypeScript/build baseline
- [x] Inventoried application routes and user-visible states
- [x] Mapped authentication, Supabase, rooms, boards, storage, realtime, 3D, and deployment architecture
- [x] Produced initial P0/P1/P2/P3 launch-readiness report
- [x] Produced initial security best-practices report
- [x] Established Kova design tokens and basic test scaffolding before the stabilization master prompt superseded the rollout order

## In Progress

- [ ] Stabilization Phase 1: validate and remediate P1 authorization and data-consistency findings

## Blocked

- [ ] Authenticated, RLS, storage, realtime, and multi-user testing — isolated Supabase URL and keys not configured
- [ ] Migration verification — no isolated Supabase project is connected; migrations must be applied manually in SQL Editor
- [ ] Production-data alias audit — no source database URL and production access is intentionally out of scope

## Bugs Found

- P0: None confirmed; runtime coverage is incomplete
- P1: Privileged service-role routes trust `getSession()` claims
- P1: Board reorder RPC expects UUID IDs while boards use text IDs
- P1: Undo/redo does not persist restored positions
- P1: Production isolation and schema parity cannot be launch-verified without an isolated Supabase project
- P2: Duplicated boards alias storage objects
- P2: Room deletion leaks board storage objects
- P2: Orphan cleanup can race direct uploads when run with `--apply`
- P2: Wall-config prefetch uses the wrong identifier until post-resolution
- P2: 3D/realtime behavior lacks production-like runtime evidence
- P2: Dependency advisories require reachability triage
- P3: Debug logs, legacy styling, inconsistent status UI, and existing lint warnings

## Decisions Needed

- Confirm that public institution domains and aggregate student counts are intended public data.
- Provide an isolated Supabase project when database, RLS, storage, realtime, and authenticated testing should begin.

## Next

- Add failing authorization tests for privileged routes and migrate them to `requireAdmin()`.
- Add a failing board-reorder contract test and prepare the text-ID migration.
- Perform a diagnostic-only pass on undo persistence before implementing a fix.
