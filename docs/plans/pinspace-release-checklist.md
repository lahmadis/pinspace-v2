# PinSpace Big-Bang Release Checklist

**Gate date:** 2026-08-15

**Branch:** `codex/pinspace-system-ui`

**Starting candidate:** `76a7071 fix: clear pre-release quality blockers`

**Audited range:** `12140c4..76a7071` — 14 commits, 247 files changed, 18,294 insertions and 12,765 deletions

**Runtime:** Node 24.12.0 and npm 11.6.2 (the default Node 20.18.2 is below the repository's `>=20.19` engine)

## Decision

**Production launch: NO-GO.** The local code gate is Chromium-ready after the release-gate fixes, but launch certification is incomplete. Migrations 036–039 are unapplied, there is no live isolated Supabase/auth/storage/RLS/realtime fixture, Firefox and WebKit executables are absent, no Vercel production build/preview has been reviewed, and product/design approval of the complete route matrix is not recorded.

This is deliberately not a false green: mocked, no-environment and signed-out checks prove their specific UI states only.

## Gate evidence

| Gate | Command/evidence | Result |
| --- | --- | --- |
| Worktree | `git status --short`, branch/log/range inspection before work | Clean at `76a7071`; correct branch and 14-commit range confirmed |
| Locked install | `npm ci --strict-peer-deps` under Node 24; lock/package SHA-256 before and after | Pass; 856 packages installed, 857 audited; manifest and lock hashes unchanged |
| Dependency audit | `npm audit --audit-level=low` | Pass: 0 known vulnerabilities |
| React runtime | `npm ls react react-dom --all` | Pass: one deduplicated React/ReactDOM 19.2.8 runtime |
| PinSpace policy | `npm run check:pinspace-ui` | Pass: 0 findings |
| Unit/component/contracts | `npm test` | Pass after security/UI repairs: 51 files, 271 tests, 0 failed |
| TypeScript | `npx tsc --noEmit --incremental false` | Pass, no output |
| Lint | `npm run lint` (`eslint . --max-warnings=0`) | Pass, zero warnings |
| Diff integrity | `git diff --check 12140c4..HEAD` | Pass |
| Unsafe DOM | scan for `dangerouslySetInnerHTML`, direct HTML assignment, `document.write`, `eval`, `new Function`, string timers, wildcard `postMessage`, `srcDoc` and `javascript:` | No hits in application/config/script source |
| Secrets | high-signal tracked-file/path scan, without printing secret values | No committed runtime secret found; only `.env.example` and documentation examples were identified |
| Palette | raw-colour scan plus `check:pinspace-ui` allowlist enforcement | 88 literals are token definitions or approved 3D/engine palettes; no PinSpace policy finding |
| Chromium E2E | `PLAYWRIGHT_PORT=43153 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- --workers=3 --reporter=dot` | Pass: 297 passed, 3 environment-skipped, 0 failed (300 total, 2.6 min) |
| Accessibility | isolated port 43154, `PLAYWRIGHT_REUSE_SERVER=0 npm run test:a11y` | 5/5 passed |
| Visual | isolated port 43155, `PLAYWRIGHT_REUSE_SERVER=0 npm run test:visual` against committed Chromium baselines | 3/3 passed |
| Firefox | Playwright executable path check | Not run: `/Users/usmanasif/Library/Caches/ms-playwright/firefox-1538/firefox/Nightly.app/Contents/MacOS/firefox` absent |
| WebKit | Playwright executable path check | Not run: `/Users/usmanasif/Library/Caches/ms-playwright/webkit-2336/pw_run.sh` absent |
| Production build | Repository instruction prohibits local `npm run build` | **Skipped intentionally**; Vercel preview build is a launch prerequisite |

The locked install emitted maintenance warnings for deprecated `whatwg-encoding@3.1.1` and unmaintained `@supabase/auth-helpers-nextjs@0.15.0`; neither has a reported npm vulnerability. Migrate the auth helper deliberately rather than forcing a release-gate upgrade.

## Release-gate fixes

1. Mobile/tablet projects inherited WebKit from Playwright's iPhone/iPad descriptors, so a supposedly Chromium-only run attempted an absent WebKit binary. `browserName: 'chromium'` is now explicit, with a configuration regression test.
2. Public-sharing board-count assertions targeted a stale `status` landmark and split text. They now target the exact visible count.
3. The demo network status locator matched multiple live regions. It is now scoped to the named demo main region.
4. The discovery error test collided with Next.js's hidden route-announcer `role="alert"`. It is now scoped to the named results region.
5. Public share and public studio viewer now include explicit 1920 px checks, completing the requested six-width representative matrix.
6. Workspace export previously treated persisted board URLs as unrestricted server fetch targets. Export now accepts only canonical HTTPS URLs on the configured Supabase origin, verifies the `board-images` object belongs to the board owner, and downloads through the service-role Storage API. Arbitrary hosts, private/non-HTTP targets, credential-shaped origins, traversal paths and HTTP redirects are no longer request targets.
7. Class creation previously accepted a client-selected public organization ID or slug. It now derives organization and instructor authority only from the authenticated user's verified profile.
8. New unapplied migration 039 adds database enforcement for verified instructor/same-organization class creation, immutable workspace authority fields, service-route-only changes to the current room publication fields (`is_published` and `published_at`), board insert membership/room-parent consistency, and immutable board owner/workspace/room parent fields for browser-authenticated writes. The migration deliberately does not reference the obsolete `rooms.is_globally_public` column dropped by migration 016. Its rollback-only verifier covers allowed authenticated default room creation, room name/order updates and board title/position updates, plus denied room publication and board-parent mutations.
9. Public-sharing E2E now fails on generic document/chunk HTTP 500 responses instead of converting them into a stale R3F skip.
10. The expanded 3D gallery minimap now has dialog semantics, initial contained focus, Tab trapping, Escape/outside dismissal, body-scroll locking and focus restoration to a stable expand trigger.
11. The Lightbox link URL input and sheet-size preset now expose explicit accessible names.

The security and UI fixes are covered by focused regression tests and the full local static/unit gate. Migration 039 was written but deliberately not applied.

The first hardened 300-case Chromium attempt reported 10 failures caused by three-worker Next development-server contention: loading states outlived default five-second assertions, while failure artifacts showed the expected state shortly afterward. After raising only those state-transition timeouts, the affected 57-case browser slice passed 57/57 and the complete fresh 300-case run passed 297 with the three documented environment skips. No HTTP 500 or product-behavior failure was accepted as a skip.

## Browser, responsive and accessibility interpretation

- Chromium exercises mobile (390 px device descriptor), tablet (768 px) and desktop projects; explicit route checks add 360, 1024, 1440 and 1920 px.
- Public share and studio-viewer fallbacks pass every target width: 360, 390, 768, 1024, 1440 and 1920 px.
- 200% zoom, reduced motion and keyboard/focus coverage are detailed in `pinspace-route-state-matrix.md`.
- The only intentional E2E skips are the authenticated network case once per Chromium project. It requires both `NEXT_PUBLIC_SUPABASE_URL` and `PLAYWRIGHT_SUPABASE_SESSION`; neither exists in this environment.
- Missing Firefox/WebKit is a real browser-matrix gap, not a pass. Installing browsers would require an approved network download; no workaround was used.
- Repeated `MaxListenersExceededWarning` messages came from the Next 16 development server during high-volume navigation. They did not fail navigation or tests, but should be compared on a Vercel preview rather than treated as production evidence.

## Development-runtime performance baseline

Captured in headless Chromium at 1440 × 900 against an owned isolated Next dev server. Values are directional development numbers, not Core Web Vitals or production budgets.

| Route | Run | Wall / TTFB / DCL / load | Resources / JS | Transfer / JS transfer |
| --- | --- | --- | --- | --- |
| `/` | cold | 1103 / 555 / 592 / 765 ms | 28 / 25 | 1391 / 1318 KB |
| `/` | warm | 568 / 24 / 57 / 95 ms | 28 / 25 | 8 / 7 KB |
| `/network` | cold | 580 / 57 / 73 / 200 ms | 31 / 25 | 1466 / 1364 KB |
| `/network` | warm | 552 / 23 / 44 / 83 ms | 30 / 25 | 8 / 7 KB |
| `/model` | cold | 567 / 37 / 58 / 179 ms | 30 / 25 | 1383 / 1309 KB |
| `/model` | warm | 574 / 37 / 68 / 100 ms | 29 / 25 | 8 / 7 KB |
| `/studio/studio-empty/view?demo=true` | cold | 970 / 435 / 451 / 611 ms | 37 / 32 | 2114 / 2040 KB |
| same studio fallback | warm | 767 / 35 / 64 / 108 ms | 39 / 32 | 11 / 9 KB |

The studio fallback is the heaviest sampled route, as expected for the 3D surface. There is no prior production benchmark or bundle budget, so these numbers cannot establish a regression. Capture production Web Vitals, long tasks, memory and GPU frame rate on the Vercel preview and representative hardware.

## Fresh whole-tree review

### P0/P1

- Independent security review validated one P1 before finalization: authenticated SSRF/response exfiltration through workspace export. The export path no longer performs arbitrary HTTP fetches and focused source/helper regressions pass. The reviewer later found a second P1 in the unapplied migration: it referenced a room column removed by migration 016. That obsolete reference is removed and a negative source regression now guards the sequential schema contract. The final independent security re-review is clean at P0–P2.
- No P0 was validated.
- Existing service-role authorization contracts reject the former privileged `getSession()` pattern and require server-verified users where service-role authority is used.
- No unsafe DOM sink or committed runtime secret was found.

### P2 and maintenance debt

- Complexity is concentrated in very large modules: `LightboxModal.tsx` (3,340 lines), `StudioRoom.tsx` (2,519), `Gallery3D.tsx` (1,623), `DraggableBoard.tsx` (1,558), `app/admin/page.tsx` (1,526), and `app/studio/[id]/page.tsx` (1,463). Their mixed UI, gesture, persistence and realtime responsibilities increase regression cost. Refactor only behind focused behavioral tests after launch gating.
- The source contains 54 files with lint suppressions, 417 `console.log`/`warn`/`error` calls and 192 explicit `any` tokens. Lint and TypeScript still pass; prioritize high-frequency 3D/upload paths, replace development logging with gated structured diagnostics, and narrow external-library types incrementally.
- `@supabase/auth-helpers-nextjs` is unmaintained and should move to the supported SSR helper in a dedicated auth migration.
- No explicit application-wide browser security-header policy was found in `next.config.js`; validate the effective Vercel headers and add a tested CSP/clickjacking/referrer/permissions policy compatible with Sentry, Supabase, 3D assets and any intended embedding.
- Production-like 3D failure, memory, reconnect, stale presence, presenter handoff and 25-user behavior remain unmeasured.

The same review also validated and repaired P2 cross-organization class injection, direct database room-publication bypass, board parent injection, generic-500 test masking, minimap modal focus behavior and two unnamed Lightbox controls. The independent frontend re-review is clean at P0–P2. Database enforcement remains launch-blocked until migrations 036–039 are applied sequentially and migration 039 is verified against a live isolated project.

These are material engineering risks but not safe big-bang gate edits: changing the fragile 3D/auth/header contracts without representative live fixtures would create more release risk than it removes.

## External launch blockers

- [ ] Provision an isolated non-production Supabase project and representative student, instructor and admin accounts across at least two institutions.
- [ ] Manually apply and verify `migrations/036_fix_board_reorder_text_ids.sql`.
- [ ] Manually apply and verify `migrations/037_harden_profile_roles_and_invites.sql`.
- [ ] Manually apply and verify `migrations/038_rate_limit_feedback.sql`.
- [ ] Apply migrations 036–039 sequentially in a disposable non-production database and confirm every migration parses against the resulting schema. This gate had no disposable PostgreSQL/Supabase fixture, so source-contract tests are not execution proof.
- [ ] After applying migration 039, run `scripts/verify-workspace-room-board-authority.sql` as an authenticated fixture owner and retain evidence for its allowed room/board mutations and expected `42501` denials.
- [ ] Exercise authenticated sign-in/sign-up/recovery/onboarding and admin role boundaries.
- [ ] Exercise cross-tenant RLS for SELECT/INSERT/UPDATE/DELETE and explicit permission-denied cases.
- [ ] Exercise uploads, duplicate/delete cleanup, storage access, room/workspace deletion, board reorder, sharing, critique, comments, presentation, presence, reconnect and multi-user realtime.
- [ ] Run a Vercel preview production build and review build output, headers, source maps and environment configuration. Local build remains intentionally skipped.
- [ ] Install and execute the route/accessibility/visual matrix in Firefox and WebKit, or record an approved narrower browser-support policy.
- [ ] Capture production performance/Web Vitals and representative 3D GPU/memory behavior.
- [ ] Obtain explicit product/design approval for every route/state in the matrix and investigate any visual-baseline update rather than auto-accepting it.
- [ ] Confirm whether public institution domains and aggregate counts are intended public data.

## Rollback

- The candidate is branch/commit based. Preserve the branch and deployed SHA so rollback is an atomic redeploy, not an ad-hoc file copy.
- **Visual-only rollback target:** `eecc653` is the commit immediately before the PinSpace UI foundation begins at `f36eb39`; this retains the preceding secure-framework/trust-boundary work.
- **Full audited-range rollback target:** `12140c4` precedes all 14 commits audited here.
- The visual redesign has no schema dependency. No migration was applied during this gate.
- If migrations 036–039 are later applied, a code rollback does not roll the database back. Treat them as forward-compatible launch prerequisites and use separately reviewed database rollback/forward-fix procedures if needed.

## Final verification

The post-repair static/unit gates are green: PinSpace policy 0 findings; Vitest 51 files/271 tests; nonincremental TypeScript exit 0; ESLint zero warnings. The complete post-repair Chromium run is green at 297 passed, 3 documented environment skips and 0 failed; accessibility is 5/5 and visual is 3/3. Independent frontend and security re-reviews are clean with no remaining validated P0–P2. Production launch stays **NO-GO** until every external blocker above is resolved or explicitly accepted by the accountable owner.
