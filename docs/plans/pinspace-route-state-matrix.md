# PinSpace Route and State Matrix

**Final gate audit:** 2026-08-15

**Scope:** all 43 App Router pages found by `find app -name page.tsx`

**Backend fixture:** intentionally absent; no live Supabase project was contacted

## Status definitions

- **Automated pass:** a real Chromium route test passed against a public, demo, mocked, or deliberate no-environment state.
- **Component-mocked pass:** Vitest rendered the route with controlled auth/API data and verified its important states and contracts.
- **Environment-blocked:** the route needs live Supabase auth, RLS, storage, realtime, or representative data; source/component checks are not a production journey.
- **Intentional redirect:** the signed-out browser was correctly sent to sign-in or the route's documented handoff destination.

An automated or component-mocked pass does not promote its live backend journey to green. Those gaps are called out in the final column.

## Public and account routes

| Route | Gate evidence | Status | Remaining live gap |
| --- | --- | --- | --- |
| `/` | Chromium overflow, reduced-motion Axe, dedicated accessibility and visual baseline | Automated pass | Signed-in landing branch needs live auth |
| `/sign-in` | Chromium keyboard/focus/validation, Axe including entry-flow contrast, visual baseline | Automated pass | Successful auth and redirect need live auth |
| `/sign-up/[[...sign-up]]` | Chromium 360 px/reduced-motion/Axe; entry-flow component contracts | Automated pass | Account creation and email verification need live auth |
| `/forgot-password` | Chromium validation, overflow, reduced-motion/Axe; dedicated accessibility suite | Automated pass | Email delivery needs live auth provider |
| `/reset-password` | Chromium invalid-link fallback, 360 px/reduced-motion/Axe | Automated pass | Valid and expired recovery-token flows need live auth |
| `/onboarding` | Signed-out Chromium redirect to sign-in; component entry-flow coverage | Intentional redirect | Institution claim success/failure needs live auth and migration 037 |
| `/terms` | Chromium landmarks, WCAG Axe, overflow, visual baseline | Automated pass | None identified |
| `/privacy` | Chromium landmarks, WCAG Axe, overflow, offline/recovery announcement | Automated pass | None identified |

## Core product routes

| Route | Gate evidence | Status | Remaining live gap |
| --- | --- | --- | --- |
| `/dashboard` | Signed-out Chromium auth boundary and 360/768/1024/1440 overflow; dashboard components cover loading/error/empty/populated/dialogs | Intentional redirect | Live personal/shared/org projects and mutations |
| `/workspace/new` | Signed-out Chromium boundary, responsive/zoom/Axe; controlled form validation and API states in Vitest | Intentional redirect | Live create and redirect; apply/verify migration 039 authority boundary |
| `/workspace/[id]` | Signed-out Chromium boundary, responsive/200% zoom; rooms/components cover loading/error/empty/populated/dialogs | Intentional redirect | Live membership, room CRUD/reorder/share and RLS; apply/verify migration 039 |
| `/workspace/[id]/settings` | Signed-out Chromium boundary and responsive checks; component tests cover denied/save/archive/delete states | Intentional redirect | Live owner/member permissions and destructive mutations |
| `/studio/new` | Signed-out Chromium auth boundary; creation form component states | Intentional redirect | Live room creation |
| `/studio/[id]` | Signed-out Chromium auth boundary; extensive studio component/source, persistence and realtime contracts | Intentional redirect | Live editing, upload, presence, presentation, comments and storage; apply/verify migration 039 board/room rules |
| `/studio/[id]/view` | Mocked Chromium empty/error viewer, keyboard alternative, 200% zoom, 360/390/768/1024/1440/1920 | Automated pass | Published live room, storage assets and realtime |
| `/board/[id]` | Signed-out proxy boundary; public board loading/error/content component tests | Intentional redirect | Live board/comment data and media |
| `/my-boards` | Signed-out proxy boundary; populated/error/retry component tests | Intentional redirect | Live personal board query |
| `/settings` | Component tests/source contracts cover loading, profile/notification saves and destructive dialogs | Component-mocked pass | Live profile save, organization leave and account deletion |

## Discovery routes

| Route | Gate evidence | Status | Remaining live gap |
| --- | --- | --- | --- |
| `/network` | Chromium no-env responsive states at 360/768/1024/1440 and component-mocked populated/error states | Automated pass | Authenticated populated browser case is skipped without fixture |
| `/network/[workspaceId]` | Client auth handoff and component/source contracts | Intentional redirect | Live workspace graph and authorization |
| `/network/shared` | Chromium no-env responsive states; component-mocked states | Automated pass | Authenticated shared-workspace data |
| `/network/shared/[workspaceId]` | Client auth handoff and component/source contracts | Intentional redirect | Live shared-workspace graph and authorization |
| `/network/wentworth` | Chromium no-env responsive states; component-mocked states | Automated pass | Live institution graph |
| `/explore` | Chromium responsive/error/keyboard/Axe/200% zoom and mocked populated directory | Automated pass | Live academic years and published studios |
| `/explore/[department]` | Chromium no-env responsive/error surface and component contracts | Automated pass | Live department data |
| `/explore/[department]/[year]` | Chromium no-env responsive state and navigation contract | Automated pass | Live published studio data |
| `/gallery` | Chromium responsive and real 3D module/canvas smoke; component empty/error/modal tests | Automated pass | Live gallery assets and production GPU/browser matrix |
| `/u/[userId]` | Chromium responsive and keyboard-opened mocked portfolio; component empty/error/populated states | Automated pass | Live public profile and board assets |

## Sharing and external participation

| Route | Gate evidence | Status | Remaining live gap |
| --- | --- | --- | --- |
| `/join/[code]` | Chromium invalid and valid signed-out handoff, token-redaction and Axe; component join states | Automated pass | Live invite join and migration 037 |
| `/share/[token]` | Mocked Chromium empty/error/token-safe/Axe/200% zoom at all six target widths; generic HTTP 500 responses are hard failures | Automated pass | Live capability, boards, storage and RLS |
| `/crit/[token]` | Mocked Chromium invalid and keyboard name-gate flows; component comment/trace alternatives | Automated pass | Live critique token, comment/trace writes and realtime |
| `/f/[slug]` | Component test verifies announced institution sign-in handoff | Intentional redirect | Live institution selection |
| `/i/[slug]` | Component test verifies signed-out/signed-in institution handoff | Intentional redirect | Live auth/session branch |

## Administrative, demo and utility routes

| Route | Gate evidence | Status | Remaining live gap |
| --- | --- | --- | --- |
| `/admin` | Signed-out proxy boundary; component/source tests cover denial/loading/error/empty/populated/mutations | Intentional redirect | Live verified admin data and mutations |
| `/admin/institutions` | Signed-out proxy boundary; admin shell/source contracts | Intentional redirect | Live organization list/create |
| `/admin/institutions/[slug]` | Signed-out proxy boundary; component/source loading/error and safe slug contracts | Intentional redirect | Live organization edit/domain actions |
| `/admin/users` | Signed-out proxy boundary; component/source search/empty/error/role actions | Intentional redirect | Live role changes and migration 037 |
| `/admin/instructors/[userId]` | Signed-out proxy boundary; component/source not-found and create-studio states | Intentional redirect | Live instructor data and provisioning |
| `/demo` | Chromium demo identity/exit controls and responsive network shell | Automated pass | Product/design approval still required |
| `/demo/studio/[id]` | Chromium real 3D module/canvas evaluation; component/source edit-mode contracts | Automated pass | Production GPU/browser matrix |
| `/demo/studio/[id]/view` | Component/source view-mode, navigation and responsive contracts | Component-mocked pass | Full real-browser viewer journey |
| `/model` | Chromium narrow-layout and real GLTF/R3F canvas evaluation | Automated pass | Production asset matrix and non-Chromium GPU checks |
| `/debug/boards` | Signed-out Chromium redirect to sign-in; production API is additionally non-development gated | Intentional redirect | Authorized local-development data only; must stay unavailable in production |

## Cross-cutting state evidence

- Responsive public/no-environment coverage includes real viewports at **360, 390, 768, 1024, 1440 and 1920 px**. The full six-width checks run on public share and studio-viewer fallbacks; discovery, workspace and dashboard shells have representative 360–1440 checks, and 1920 is covered by the two highest-risk immersive/public shells.
- 200% zoom passes on discovery, workspace, public sharing and public studio viewer surfaces.
- Reduced motion passes on public entry routes and the visual-baseline routes.
- Keyboard/focus passes cover sign-in password controls, discovery directory items, public profile board opening, guest critique, and the public studio control alternative.
- Automated Axe evidence covers entry, legal, discovery error, workspace fallback, public sharing and viewer-error states. No serious or critical violations were reported in the completed suites.
- Global delayed-loading, error, offline and restored-online announcements pass in Chromium.
- Source/helper regressions cover export URL trust and the migration 039 workspace/room/board authority boundary, including the absence of the obsolete room column removed by migration 016. These are not database execution evidence: migrations 036–039 are unapplied, no disposable database was available for a sequential parse/apply, and migration 039's authenticated rollback verifier still requires the isolated launch fixture.

## Release interpretation

The source/component/no-env states are code-gate evidence, not a claim that production data behavior passed. All authenticated Supabase, cross-tenant RLS, storage, realtime and multi-user journeys remain **environment-blocked** until the launch prerequisites in `pinspace-release-checklist.md` are completed.
