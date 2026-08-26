# Review: `origin/codex/kova-system-ui` vs `master`

**Read-only review.** Nothing was checked out, merged, modified, or pushed. All findings come from `git log`, `git diff`, and `git show` against the fetched remote ref.

- Merge base: `79d399e` (current `master` tip) — the branch is a clean fast-forward, `0` commits behind.
- Branch tip: `9a3e37d`
- Scope: **288 files changed, 23,707 insertions(+), 13,648 deletions(-)**
- Author of all 31 commits: **Usman Asif `<usmanasif193@gmail.com>`**

> ### Headline
> This is **not** a fixes-only branch. It contains a **Next.js 14 → 16 and React 18 → 19 major framework upgrade**, a **full visual redesign ("Kova"/PinSpace branding) of every route**, a **new test infrastructure (Vitest + Playwright, ~60 new test files)**, and **4 new database migrations**. The genuine fixes are real and mostly good, but they are entangled with a very large amount of new work. See §6.

---

## 1. Commits (`git log --oneline master..origin/codex/kova-system-ui`)

All 31 commits are authored **and** committed by `Usman Asif <usmanasif193@gmail.com>`.

| # | SHA | Date | Message |
|---|-----|------|---------|
| 1 | `9a3e37d` | 2026-08-16 | fix: exclude local secrets from deployment |
| 2 | `308e11e` | 2026-08-16 | refactor: standardize PinSpace branding |
| 3 | `45a4471` | 2026-08-15 | Merge branch 'codex/kova-system-ui' |
| 4 | `2b41ab8` | 2026-08-15 | Merge branch 'master' of https://github.com/lahmadis/pinspace-v2 |
| 5 | `32c790a` | 2026-08-15 | fix: close final release gate blockers |
| 6 | `76a7071` | 2026-08-15 | fix: clear pre-release quality blockers |
| 7 | `122f9ff` | 2026-08-15 | refactor: enforce Kova UI consistency |
| 8 | `43902fe` | 2026-08-15 | feat: unify Kova feedback states |
| 9 | `444fa2b` | 2026-08-15 | feat: redesign Kova secondary routes |
| 10 | `71ead39` | 2026-08-14 | feat: redesign Kova public sharing flows |
| 11 | `426d2d6` | 2026-08-14 | feat: redesign Kova studio experience |
| 12 | `daa8644` | 2026-08-14 | feat: redesign Kova discovery |
| 13 | `9f47959` | 2026-08-14 | feat: redesign Kova workspaces |
| 14 | `d46eb77` | 2026-08-14 | feat: redesign Kova dashboard |
| 15 | `74ce6cf` | 2026-08-14 | feat: redesign Kova entry flows |
| 16 | `fdfb8ea` | 2026-08-14 | feat: add Kova application shells |
| 17 | `f36eb39` | 2026-08-14 | feat: add accessible Kova primitives |
| 18 | `eecc653` | 2026-08-14 | fix: harden core trust boundaries |
| 19 | `4682372` | 2026-08-14 | fix: upgrade secure framework baseline |
| 20 | `12140c4` | 2026-08-14 | fix: clean workspace storage on deletion |
| 21 | `2f24dbd` | 2026-08-14 | fix: verify all service role callers |
| 22 | `db4c332` | 2026-08-14 | fix: harden board storage lifecycle |
| 23 | `698ac79` | 2026-08-14 | fix: stabilize room loading and realtime cleanup |
| 24 | `c060b88` | 2026-08-14 | refactor: update stabilization status |
| 25 | `e25b0da` | 2026-08-14 | fix: persist board undo positions |
| 26 | `aab1a48` | 2026-08-14 | fix: align board reorder id types |
| 27 | `90295e0` | 2026-08-14 | fix: verify privileged route identities |
| 28 | `e17a447` | 2026-08-14 | refactor: document launch readiness audit |
| 29 | `48db8b8` | 2026-08-14 | feat: establish Kova UI foundation |
| 30 | `7f477c0` | 2026-08-14 | refactor: plan Kova system-wide UI rollout |
| 31 | `e1dccc7` | 2026-08-14 | refactor: plan fresh Supabase bootstrap |

Note commit #3 is a merge of a branch into itself and #4 merges `master` — history is not linear.

---

## 2. Diffstat (`git diff --stat master..origin/codex/kova-system-ui`)

```
 .env.example                                       |   13 +
 .eslintrc.json                                     |   13 -
 .vercelignore                                      |    1 +
 CLAUDE.md                                          |   10 +
 README.md                                          |    2 +-
 app/admin/institutions/[slug]/page.tsx             |  180 +-
 app/admin/instructors/[userId]/page.tsx            |  125 +-
 app/admin/page.tsx                                 |  587 +-
 app/admin/users/page.tsx                           |  126 +-
 .../institutions/[slug]/domains/[domain]/route.ts  |   14 +-
 app/api/admin/institutions/[slug]/domains/route.ts |   23 +-
 app/api/admin/institutions/[slug]/route.ts         |   32 +-
 app/api/admin/institutions/[slug]/stats/route.ts   |   18 +-
 app/api/admin/instructors/[userId]/route.ts        |    4 +-
 app/api/admin/overview/route.ts                    |   18 +-
 app/api/admin/stats/route.ts                       |   18 +-
 app/api/admin/studios/[id]/membership/route.ts     |   16 +-
 app/api/admin/studios/[id]/owner/route.ts          |    4 +-
 app/api/board-comments/[commentId]/route.ts        |   40 +-
 app/api/boards/[id]/board-comments/route.ts        |   34 +-
 app/api/boards/[id]/comments/route.ts              |   75 +-
 app/api/boards/[id]/owner/route.ts                 |    4 +-
 app/api/boards/[id]/position/route.ts              |   18 +-
 app/api/boards/[id]/route.ts                       |   25 +-
 app/api/boards/[id]/traces/route.ts                |   54 +-
 app/api/boards/duplicate/route.ts                  |   76 +-
 app/api/boards/reindex-after-wall-delete/route.ts  |    8 +-
 app/api/boards/route.ts                            |  145 +-
 app/api/comments/route.ts                          |   17 +-
 app/api/crit/[token]/boards/route.ts               |    4 +-
 app/api/debug/boards/route.ts                      |   40 +-
 app/api/debug/check-types/route.ts                 |   40 +-
 app/api/explore/[department]/years/route.ts        |    5 +-
 app/api/explore/academic-years/route.ts            |   14 +-
 app/api/explore/studios/route.ts                   |   15 +-
 app/api/feedback/route.ts                          |   57 +-
 app/api/institutions/route.ts                      |   23 +-
 app/api/my-boards/route.ts                         |    2 +-
 app/api/network/personal/[workspaceId]/route.ts    |    9 +-
 app/api/network/personal/route.ts                  |    2 +-
 app/api/network/shared/[workspaceId]/route.ts      |   11 +-
 app/api/network/shared/route.ts                    |    2 +-
 app/api/network/wentworth/route.ts                 |    2 +-
 app/api/rooms/[id]/guest-tokens/route.ts           |   36 +-
 app/api/rooms/[id]/route.ts                        |  131 +-
 app/api/rooms/[id]/share/route.ts                  |   15 +-
 app/api/settings/delete-account/route.ts           |    2 +-
 app/api/settings/leave-organization/route.ts       |    2 +-
 app/api/settings/notifications/route.ts            |    2 +-
 app/api/settings/profile/route.ts                  |    2 +-
 app/api/share/[token]/boards/route.ts              |    4 +-
 app/api/studios/[id]/view/route.ts                 |    7 +-
 app/api/studios/[id]/wall-config/route.ts          |   14 +-
 app/api/superadmin/orgs/route.ts                   |    8 +-
 app/api/upload-model/route.ts                      |    3 +-
 app/api/user-profile/claim-domain/route.ts         |    2 +-
 app/api/user-profile/route.ts                      |    4 +-
 app/api/users/[id]/boards/route.ts                 |    4 +-
 app/api/workspaces/[id]/archive/route.ts           |    6 +-
 app/api/workspaces/[id]/export/route.ts            |   39 +-
 app/api/workspaces/[id]/join/route.ts              |   41 +-
 app/api/workspaces/[id]/leave/route.ts             |   21 +-
 app/api/workspaces/[id]/members/enroll/route.ts    |   21 +-
 app/api/workspaces/[id]/network-metadata/route.ts  |   21 +-
 app/api/workspaces/[id]/rooms/reorder/route.ts     |   21 +-
 app/api/workspaces/[id]/rooms/route.ts             |   21 +-
 app/api/workspaces/[id]/route.ts                   |  146 +-
 app/api/workspaces/by-invite/[code]/route.ts       |   67 +---------
 app/api/workspaces/route.ts                        |   80 +-
 app/board/[id]/page.tsx                            |  453 +-
 app/crit/[token]/error.tsx                         |   44 +-
 app/crit/[token]/page.tsx                          |  224 +-
 app/dashboard/page.tsx                             |  181 +-
 app/debug/boards/page.tsx                          |  143 +-
 app/demo/page.tsx                                  |   34 +-
 app/demo/studio/[id]/page.tsx                      |   55 +-
 app/demo/studio/[id]/view/page.tsx                 |   62 +-
 app/explore/[department]/[year]/page.tsx           |  275 +-
 app/explore/[department]/page.tsx                  |  476 +-
 app/explore/page.tsx                               |  519 +-
 app/f/[slug]/page.tsx                              |    7 +-
 app/forgot-password/page.tsx                       |  158 +-
 app/gallery/page.tsx                               |   51 +-
 app/global-error.tsx                               |   48 +-
 app/globals.css                                    |   75 +-
 app/i/[slug]/page.tsx                              |    9 +-
 app/join/[code]/page.tsx                           |  259 +-
 app/layout.tsx                                     |   15 +-
 app/model/page.tsx                                 |   98 +-
 app/my-boards/page.tsx                             |  286 +-
 app/network/[workspaceId]/page.tsx                 |  198 +-
 app/network/page.tsx                               |  161 +-
 app/network/shared/[workspaceId]/page.tsx          |  198 +-
 app/network/shared/page.tsx                        |  154 +-
 app/network/wentworth/page.tsx                     |  161 +-
 app/onboarding/page.tsx                            |  180 +-
 app/page.tsx                                       |  289 +-
 app/reset-password/page.tsx                        |  106 +-
 app/settings/page.tsx                              |  298 +-
 app/share/[token]/error.tsx                        |   44 +-
 app/share/[token]/page.tsx                         |  142 +-
 app/sign-in/page.tsx                               |  222 +-
 app/sign-up/[[...sign-up]]/page.tsx                |  346 +-
 app/studio/[id]/error.tsx                          |   36 +-
 app/studio/[id]/page.tsx                           |  198 +-
 app/studio/[id]/view/error.tsx                     |   36 +-
 app/studio/[id]/view/page.tsx                      |  123 +-
 app/studio/new/page.tsx                            |  228 +-
 app/u/[userId]/page.tsx                            |  244 +-
 app/workspace/[id]/page.tsx                        | 1366 +--
 app/workspace/[id]/settings/page.tsx               |  860 +-
 app/workspace/new/page.tsx                         |  323 +-
 components/3d/BoardThumbnail.tsx                   |   21 +-
 components/3d/CameraController.tsx                 |   11 +-
 components/3d/DraggableBoard.tsx                   |   36 +-
 components/3d/DraggableText.tsx                    |    7 +-
 components/3d/EditModeOverlay.tsx                  |   44 +-
 components/3d/FloorEditorOverlay.tsx               |  287 +-
 components/3d/ModelViewer.tsx                      |   14 +-
 components/3d/PDFTexture.tsx                       |   11 +-
 components/3d/PresenceBar.tsx                      |   15 +-
 components/3d/SceneErrorBoundary.tsx               |   82 +
 components/3d/StudioRoom.tsx                       |  143 +-
 components/3d/TableWithModel.tsx                   |    7 +-
 components/3d/VideoBadge.tsx                       |    3 +-
 components/3d/Wall.tsx                             |    5 +-
 components/3d/WallDropZone.tsx                     |    9 +-
 components/3d/WallSurface.tsx                      |    3 +-
 components/3d/WallSystem.tsx                       |   13 +-
 components/3d/enginePalette.ts                     |   36 +
 components/3d/useBoardState.ts                     |  144 +-
 components/3d/useBoardTexture.ts                   |   17 +-
 components/3d/useDisposableGeometry.ts             |    4 +-
 components/AvatarMenu.tsx                          |   88 +-
 components/CommentPanel.tsx                        |  308 +-
 components/CritModeHeader.tsx                      |   26 +-
 components/DemoBanner.tsx                          |   30 +-
 components/FeedbackButton.tsx                      |  171 +-
 components/Gallery3D.tsx                           |  249 +-
 components/GalleryAvatarModal.tsx                  |  192 +-
 components/InstitutionCard.tsx                     |   77 +-
 components/JoinClassModal.tsx                      |  185 +-
 components/LegalDocument.tsx                       |   28 +-
 components/LightboxModal.tsx                       |  464 +-
 components/Loading.tsx                             |   54 +-
 components/PDFRenderer.tsx                         |   18 +-
 components/PinModeHeader.tsx                       |   37 +-
 components/PublishCategoryModal.tsx                |  183 +-
 components/PublishConfirmModal.tsx                 |  355 +-
 components/QuickNotePanel.tsx                      |   41 +-
 components/RightCommentPanel.tsx                   |  169 +-
 components/ShareModal.tsx                          |  185 +-
 components/SideCommentPanel.tsx                    |  340 +-
 components/Toaster.tsx                             |   92 +-
 components/admin/AdminShell.tsx                    |   28 +
 components/admin/CreateStudioForm.tsx              |  245 +-
 components/admin/InstructorPicker.tsx              |  201 +-
 components/auth/AuthShell.tsx                      |   75 +
 components/dashboard/DashboardActionDialogs.tsx    |  149 +
 components/dashboard/DashboardMain.tsx             |  577 +-
 components/dashboard/DashboardSidebar.tsx          |  367 +-
 components/dashboard/SuperadminOrgSwitcher.tsx     |   20 +-
 components/discovery/NetworkRouteShell.tsx         |   87 +
 components/layout/AppShell.tsx                     |   49 +
 components/layout/AppSidebar.tsx                   |  106 +
 components/layout/MobileNav.tsx                    |  109 +
 components/layout/PageHeader.tsx                   |   44 +
 components/layout/StudioShell.tsx                  |   41 +
 components/network/BubbleNetwork.tsx               |  188 +-
 components/network/NetworkView.tsx                 |  225 +-
 components/public/PublicStudioShell.tsx            |  168 +
 components/system/NetworkStatus.tsx                |  102 +
 components/ui/Menu.tsx                             |  190 +
 components/ui/Overlays.tsx                         |  205 +
 components/ui/PasswordInput.tsx                    |   22 +-
 components/ui/Primitives.tsx                       |  271 +
 components/ui/Tabs.tsx                             |  137 +
 components/ui/Tooltip.tsx                          |   84 +
 components/ui/index.ts                             |   18 +
 components/ui/utils.ts                             |    3 +
 components/useImageViewport.ts                     |    2 +-
 docs/STATUS.md                                     |   80 +
 docs/audit/2026-08-14-launch-readiness-audit.md    |  161 +
 docs/plans/2026-08-14-fresh-supabase-bootstrap.md  |   66 +
 .../2026-08-14-pinspace-system-wide-ui-design.md   |   82 +
 docs/plans/2026-08-14-pinspace-system-wide-ui.md   |  344 +
 docs/plans/pinspace-release-checklist.md           |  136 +
 docs/plans/pinspace-route-state-matrix.md          |   98 +
 eslint.config.mjs                                  |   44 +
 hooks/useBoardUpload.ts                            |   30 +-
 lib/ProfileContext.tsx                             |    1 +
 lib/auth/requireAdmin.ts                           |    2 +-
 lib/design/tokens.ts                               |   21 +
 lib/feedback/security.ts                           |   57 +
 lib/security/safeRedirect.ts                       |   21 +
 lib/storage/boardObjects.ts                        |  154 +
 lib/storage/supabaseCleanup.ts                     |   80 +
 lib/studioViewCache.ts                             |   64 +-
 lib/supabase/server.ts                             |    6 +-
 lib/useAccountMode.ts                              |   30 +-
 lib/workspaceUtils.ts                              |   14 +-
 lib/workspaces/createWorkspace.ts                  |    2 +-
 lib/workspaces/inviteCodes.ts                      |   19 +
 migrations/036_fix_board_reorder_text_ids.sql      |   33 +
 .../037_harden_profile_roles_and_invites.sql       |   60 +
 migrations/038_rate_limit_feedback.sql             |   68 +
 .../039_harden_workspace_room_board_authority.sql  |  156 +
 next.config.js                                     |    3 -
 package-lock.json                                  | 9221 +++++++++++++-------
 package.json                                       |   48 +-
 playwright.config.ts                               |   35 +
 middleware.ts => proxy.ts                          |    6 +-
 scripts/check-pinspace-ui.mjs                      |  300 +
 scripts/cleanup-orphan-storage.ts                  |  116 +-
 scripts/verify-profile-privilege-boundary.sql      |   36 +
 scripts/verify-workspace-room-board-authority.sql  |  117 +
 security_best_practices_report.md                  |   52 +
 tailwind.config.js                                 |   57 +-
 tests/3d/scene-error-boundary.test.tsx             |   72 +
 tests/a11y/core-routes.spec.ts                     |   18 +
 tests/boards/undo-persistence.test.ts              |   40 +
 tests/cache/studio-view-cache.test.ts              |   88 +
 tests/components/auth/entry-flows.test.tsx         |  383 +
 .../components/dashboard/DashboardDialogs.test.tsx |   66 +
 tests/components/dashboard/DashboardMain.test.tsx  |  119 +
 tests/components/dashboard/JoinClassModal.test.tsx |   60 +
 tests/components/dashboard/MyBoardsPage.test.tsx   |   58 +
 .../dashboard/SuperadminOrgSwitcher.test.tsx       |   33 +
 tests/components/dashboard/accessibility.test.tsx  |   67 +
 tests/components/discovery/BubbleNetwork.test.tsx  |   72 +
 tests/components/discovery/ExplorePage.test.tsx    |   55 +
 .../discovery/GalleryAvatarModal.test.tsx          |   30 +
 tests/components/discovery/GalleryMinimap.test.tsx |   48 +
 tests/components/discovery/GalleryPage.test.tsx    |   17 +
 tests/components/discovery/NetworkPage.test.tsx    |   55 +
 tests/components/discovery/PublicProfile.test.tsx  |   41 +
 tests/components/feedback-states.test.tsx          |  205 +
 tests/components/layout/AppShell.test.tsx          |  190 +
 tests/components/layout/AvatarMenu.test.tsx        |   65 +
 tests/components/layout/DashboardSidebar.test.tsx  |  205 +
 tests/components/public/BoardPage.test.tsx         |  146 +
 tests/components/public/JoinAndHandoffs.test.tsx   |  156 +
 tests/components/public/LightboxModal.test.tsx     |  145 +
 .../public/PublicSourceContracts.test.ts           |   11 +
 .../components/public/PublicStudioRoutes.test.tsx  |  191 +
 tests/components/public/PublishDialogs.test.tsx    |   93 +
 .../secondary/SecondaryComponents.test.tsx         |  123 +
 .../secondary/SecondarySourceContracts.test.ts     |  146 +
 tests/components/studio/StudioControls.test.tsx    |  205 +
 .../studio/StudioSourceContracts.test.ts           |   89 +
 tests/components/ui/password-input.test.tsx        |   64 +
 tests/components/ui/primitives.test.tsx            |  292 +
 .../components/workspace/CreateStudioForm.test.tsx |   52 +
 .../components/workspace/InstitutionCard.test.tsx  |   25 +
 .../components/workspace/InstructorPicker.test.tsx |   54 +
 .../components/workspace/NewWorkspacePage.test.tsx |   73 +
 .../workspace/WorkspaceRoomsPage.test.tsx          |  156 +
 .../workspace/WorkspaceSettingsPage.test.tsx       |  132 +
 tests/database/board-reorder-contract.test.ts      |   16 +
 tests/design/tokens.test.ts                        |   19 +
 tests/e2e/auth-onboarding.spec.ts                  |   63 +
 tests/e2e/current-behavior.spec.ts                 |   25 +
 tests/e2e/dashboard-projects.spec.ts               |   17 +
 tests/e2e/exceptional-states.spec.ts               |   42 +
 tests/e2e/network-discovery.spec.ts                |  101 +
 tests/e2e/public-sharing.spec.ts                   |  112 +
 tests/e2e/secondary-routes.spec.ts                 |   38 +
 tests/e2e/studio-controls.spec.ts                  |   82 +
 tests/e2e/three-runtime.spec.ts                    |   32 +
 tests/e2e/workspace-management.spec.ts             |   38 +
 tests/realtime/channel-lifecycle.test.ts           |   39 +
 tests/scripts/check-pinspace-ui.test.ts            |  202 +
 tests/scripts/pinspace-brand.test.ts               |   67 +
 tests/scripts/playwright-discovery.test.ts         |   37 +
 tests/scripts/runtime-dependencies.test.ts         |   28 +
 tests/scripts/vercel-deploy-safety.test.ts         |   18 +
 tests/security/core-flow-hardening.test.ts         |  179 +
 tests/security/safe-redirect.test.ts               |   25 +
 tests/security/verified-admin-routes.test.ts       |   54 +
 tests/setup.ts                                     |   15 +
 tests/storage/board-objects.test.ts                |   98 +
 tests/storage/storage-route-contracts.test.ts      |   50 +
 tests/visual/pinspace-routes.spec.ts               |   28 +
 .../pinspace-routes.spec.ts-snapshots/landing.png  |  Bin 0 -> 136851 bytes
 .../pinspace-routes.spec.ts-snapshots/sign-in.png  |  Bin 0 -> 60477 bytes
 .../pinspace-routes.spec.ts-snapshots/terms.png    |  Bin 0 -> 674381 bytes
 tsconfig.json                                      |    5 +-
 vitest.config.ts                                   |   17 +
 288 files changed, 23707 insertions(+), 13648 deletions(-)
```

---

## 3. Changed files, bucketed

### 3a. UI only — components, styles, page layout (**155 files**)

**App route pages / error boundaries (55):**
`app/admin/institutions/[slug]/page.tsx`, `app/admin/instructors/[userId]/page.tsx`, `app/admin/page.tsx`, `app/admin/users/page.tsx`, `app/board/[id]/page.tsx`, `app/crit/[token]/error.tsx`, `app/crit/[token]/page.tsx`, `app/dashboard/page.tsx`, `app/debug/boards/page.tsx`, `app/demo/page.tsx`, `app/demo/studio/[id]/page.tsx`, `app/demo/studio/[id]/view/page.tsx`, `app/explore/[department]/[year]/page.tsx`, `app/explore/[department]/page.tsx`, `app/explore/page.tsx`, `app/f/[slug]/page.tsx`, `app/forgot-password/page.tsx`, `app/gallery/page.tsx`, `app/global-error.tsx`, `app/globals.css`, `app/i/[slug]/page.tsx`, `app/join/[code]/page.tsx`, `app/layout.tsx`, `app/model/page.tsx`, `app/my-boards/page.tsx`, `app/network/[workspaceId]/page.tsx`, `app/network/page.tsx`, `app/network/shared/[workspaceId]/page.tsx`, `app/network/shared/page.tsx`, `app/network/wentworth/page.tsx`, `app/onboarding/page.tsx`, `app/page.tsx`, `app/reset-password/page.tsx`, `app/settings/page.tsx`, `app/share/[token]/error.tsx`, `app/share/[token]/page.tsx`, `app/sign-in/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`, `app/studio/[id]/error.tsx`, `app/studio/[id]/page.tsx`, `app/studio/[id]/view/error.tsx`, `app/studio/[id]/view/page.tsx`, `app/studio/new/page.tsx`, `app/u/[userId]/page.tsx`, `app/workspace/[id]/page.tsx`, `app/workspace/[id]/settings/page.tsx`, `app/workspace/new/page.tsx`

**Components (existing, modified):** `components/AvatarMenu.tsx`, `CommentPanel.tsx`, `CritModeHeader.tsx`, `DemoBanner.tsx`, `FeedbackButton.tsx`, `Gallery3D.tsx`, `GalleryAvatarModal.tsx`, `InstitutionCard.tsx`, `JoinClassModal.tsx`, `LegalDocument.tsx`, `LightboxModal.tsx`, `Loading.tsx`, `PDFRenderer.tsx`, `PinModeHeader.tsx`, `PublishCategoryModal.tsx`, `PublishConfirmModal.tsx`, `QuickNotePanel.tsx`, `RightCommentPanel.tsx`, `ShareModal.tsx`, `SideCommentPanel.tsx`, `Toaster.tsx`, `useImageViewport.ts`, `admin/CreateStudioForm.tsx`, `admin/InstructorPicker.tsx`, `dashboard/DashboardMain.tsx`, `dashboard/DashboardSidebar.tsx`, `dashboard/SuperadminOrgSwitcher.tsx`, `network/BubbleNetwork.tsx`, `network/NetworkView.tsx`, `ui/PasswordInput.tsx`

**Components (NEW — 20 files):** `components/3d/SceneErrorBoundary.tsx`, `components/3d/enginePalette.ts`, `components/admin/AdminShell.tsx`, `components/auth/AuthShell.tsx`, `components/dashboard/DashboardActionDialogs.tsx`, `components/discovery/NetworkRouteShell.tsx`, `components/layout/AppShell.tsx`, `components/layout/AppSidebar.tsx`, `components/layout/MobileNav.tsx`, `components/layout/PageHeader.tsx`, `components/layout/StudioShell.tsx`, `components/public/PublicStudioShell.tsx`, `components/system/NetworkStatus.tsx`, `components/ui/Menu.tsx`, `components/ui/Overlays.tsx`, `components/ui/Primitives.tsx`, `components/ui/Tabs.tsx`, `components/ui/Tooltip.tsx`, `components/ui/index.ts`, `components/ui/utils.ts`

**3D components (mostly palette/token substitution):** `components/3d/BoardThumbnail.tsx`, `CameraController.tsx`, `DraggableBoard.tsx`, `DraggableText.tsx`, `EditModeOverlay.tsx`, `FloorEditorOverlay.tsx`, `ModelViewer.tsx`, `PDFTexture.tsx`, `PresenceBar.tsx`, `StudioRoom.tsx`, `TableWithModel.tsx`, `VideoBadge.tsx`, `Wall.tsx`, `WallDropZone.tsx`, `WallSurface.tsx`, `WallSystem.tsx`, `useBoardTexture.ts`, `useDisposableGeometry.ts`

> ⚠️ **Two files sit in `components/` but are NOT cosmetic** and are reviewed in §4: `components/3d/useBoardState.ts` (board position/undo persistence) and `components/3d/StudioRoom.tsx` (realtime subscription deps).

### 3b. API routes — `app/api/**` (**60 files, all modified, none added or deleted**)

`admin/institutions/[slug]/domains/[domain]/route.ts`, `admin/institutions/[slug]/domains/route.ts`, `admin/institutions/[slug]/route.ts`, `admin/institutions/[slug]/stats/route.ts`, `admin/instructors/[userId]/route.ts`, `admin/overview/route.ts`, `admin/stats/route.ts`, `admin/studios/[id]/membership/route.ts`, `admin/studios/[id]/owner/route.ts`, `board-comments/[commentId]/route.ts`, `boards/[id]/board-comments/route.ts`, `boards/[id]/comments/route.ts`, `boards/[id]/owner/route.ts`, `boards/[id]/position/route.ts`, `boards/[id]/route.ts`, `boards/[id]/traces/route.ts`, `boards/duplicate/route.ts`, `boards/reindex-after-wall-delete/route.ts`, `boards/route.ts`, `comments/route.ts`, `crit/[token]/boards/route.ts`, `debug/boards/route.ts`, `debug/check-types/route.ts`, `explore/[department]/years/route.ts`, `explore/academic-years/route.ts`, `explore/studios/route.ts`, `feedback/route.ts`, `institutions/route.ts`, `my-boards/route.ts`, `network/personal/[workspaceId]/route.ts`, `network/personal/route.ts`, `network/shared/[workspaceId]/route.ts`, `network/shared/route.ts`, `network/wentworth/route.ts`, `rooms/[id]/guest-tokens/route.ts`, `rooms/[id]/route.ts`, `rooms/[id]/share/route.ts`, `settings/delete-account/route.ts`, `settings/leave-organization/route.ts`, `settings/notifications/route.ts`, `settings/profile/route.ts`, `share/[token]/boards/route.ts`, `studios/[id]/view/route.ts`, `studios/[id]/wall-config/route.ts`, `superadmin/orgs/route.ts`, `upload-model/route.ts`, `user-profile/claim-domain/route.ts`, `user-profile/route.ts`, `users/[id]/boards/route.ts`, `workspaces/[id]/archive/route.ts`, `workspaces/[id]/export/route.ts`, `workspaces/[id]/join/route.ts`, `workspaces/[id]/leave/route.ts`, `workspaces/[id]/members/enroll/route.ts`, `workspaces/[id]/network-metadata/route.ts`, `workspaces/[id]/rooms/reorder/route.ts`, `workspaces/[id]/rooms/route.ts`, `workspaces/[id]/route.ts`, `workspaces/by-invite/[code]/route.ts`, `workspaces/route.ts`

### 3c. Database — migrations & SQL (**6 files, all new**)

- `migrations/036_fix_board_reorder_text_ids.sql` (NEW)
- `migrations/037_harden_profile_roles_and_invites.sql` (NEW)
- `migrations/038_rate_limit_feedback.sql` (NEW)
- `migrations/039_harden_workspace_room_board_authority.sql` (NEW)
- `scripts/verify-profile-privilege-boundary.sql` (NEW, verification only)
- `scripts/verify-workspace-room-board-authority.sql` (NEW, verification only)

### 3d. Auth / session handling

- `proxy.ts` (**renamed from `middleware.ts`**) — the auth-cookie gate for protected routes
- `lib/auth/requireAdmin.ts`
- `lib/security/safeRedirect.ts` (NEW)
- `lib/useAccountMode.ts`
- `lib/ProfileContext.tsx`
- `lib/workspaces/inviteCodes.ts` (NEW)
- `lib/workspaceUtils.ts` (invite-code / workspace-id generation)
- Plus the session-verification rewrite inside all 60 API routes (§4a)

### 3e. Supabase client setup / service-role usage

- `lib/supabase/server.ts` — `supabaseServer()` becomes **async**
- `lib/storage/supabaseCleanup.ts` (NEW) — service-role storage helpers
- `lib/storage/boardObjects.ts` (NEW) — storage-path parsing/ownership
- `lib/workspaces/createWorkspace.ts`
- `scripts/cleanup-orphan-storage.ts`
- Service-role call-site churn across `app/api/**` (§5c)

### 3f. Config

- `package.json`, `package-lock.json` (9,221 lines)
- `next.config.js`
- `proxy.ts` ← `middleware.ts`
- `.env.example`
- `.vercelignore`
- `tsconfig.json`
- `tailwind.config.js`
- `.eslintrc.json` (**DELETED**) → `eslint.config.mjs` (NEW)
- `vitest.config.ts` (NEW), `playwright.config.ts` (NEW)

### 3g. Fits none of the above

- **Non-UI app logic:** `components/3d/useBoardState.ts`, `hooks/useBoardUpload.ts`, `lib/studioViewCache.ts`, `lib/design/tokens.ts` (NEW), `lib/feedback/security.ts` (NEW)
- **Tooling:** `scripts/check-pinspace-ui.mjs` (NEW, 300 lines — a custom design-token linter)
- **Docs:** `CLAUDE.md`, `README.md`, `docs/STATUS.md`, `docs/audit/2026-08-14-launch-readiness-audit.md`, `docs/plans/*` (5 files), `security_best_practices_report.md` (NEW, at repo root)
- **Tests:** ~60 new files under `tests/` including 3 binary PNG visual-regression baselines (`landing.png`, `sign-in.png`, `terms.png` — 674 KB for terms.png alone)

---

## 4. Behavior changes in every non-UI file

### 4a. Framework upgrade — the dominant change (`package.json`)

```diff
-    "@react-three/drei": "^9.122.0",
-    "@react-three/fiber": "^8.18.0",
+    "@react-three/drei": "10.7.8",
+    "@react-three/fiber": "9.7.0",
-    "@supabase/auth-ui-react": "^0.4.7",
-    "@supabase/auth-ui-shared": "^0.1.8",
-    "framer-motion": "^10.18.0",
+    "framer-motion": "11.13.5",
-    "next": "^14.1.0",
+    "next": "^16.3.1",
-    "react": "^18.2.0",
-    "react-dom": "^18.2.0",
+    "react": "19.2.8",
+    "react-dom": "19.2.8",
-    "eslint": "^8.55.0",
-    "eslint-config-next": "^14.1.0",
+    "eslint": "^9.39.5",
+    "eslint-config-next": "^16.3.1",
+  "engines": { "node": ">=20.19.0" },
```

**What changed:** Next.js jumps **two major versions** (14 → 16), React jumps **one** (18 → 19), React Three Fiber jumps **one** (8 → 9), drei **9 → 10**, framer-motion **10 → 11**, ESLint **8 → 9**. `@supabase/auth-ui-react` and `@supabase/auth-ui-shared` are dropped entirely (the redesigned auth pages hand-roll their forms). Node floor raised to 20.19.0. Every downstream change in §4b–§4d is a consequence of this upgrade.

### 4b. `middleware.ts` → `proxy.ts` — the auth gate is renamed

```diff
-export function middleware(req: NextRequest) {
+export function proxy(req: NextRequest) {
```

**What changed:** Next.js 16 renamed the middleware entry point from `middleware.ts`/`export function middleware` to `proxy.ts`/`export function proxy`. The matcher and the redirect logic are byte-identical (90% similarity). **This is correct for Next 16 and catastrophic on Next 14** — under Next 14 the file is simply never loaded, so every protected route in `PROTECTED_PREFIXES` would silently lose its auth-cookie gate. This file is the single strongest argument that the branch cannot be partially merged: **`proxy.ts` and the `next@16` bump must land together or not at all.**

### 4c. `lib/supabase/server.ts` — `supabaseServer()` is now async

```diff
-export const supabaseServer = () => {
-  const cookieStore = cookies()
+export const supabaseServer = async () => {
+  const cookieStore = await cookies()
```

**What changed:** Next 16 made `cookies()` async. Every one of ~50 call sites now needs `await supabaseServer()`. `supabaseServiceRole()` is untouched (it takes no cookies). This is the mechanical reason nearly every API route appears in the diff.

### 4d. All 60 API routes — three mechanical rewrites

**(i) `params` is now a Promise** (Next 15/16 breaking change), applied to every dynamic route:

```diff
-  { params }: { params: { id: string } }
+  { params }: { params: Promise<{ id: string }> }
 ) {
-    const boardId = params.id
+    const boardId = (await params).id
```

Verified complete: `git grep 'params }: { params: {'` returns **zero** hits on the branch.

**(ii) `getSession()` → `getUser()`** — a genuine security fix, not just an upgrade artifact:

```diff
-    const supabase = supabaseServer()
+    const supabase = await supabaseServer()
     const {
-      data: { session },
-      error: sessionError,
-    } = await supabase.auth.getSession()
-    if (sessionError) {
-      console.error('Session error:', sessionError)
-      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
-    }
-    const userId = session?.user?.id
-    if (!userId) {
+      data: { user },
+      error: userError,
+    } = await supabase.auth.getUser()
+    if (userError || !user?.id) {
       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
     }
+    const userId = user.id
```

`getSession()` reads the cookie without verifying the JWT signature; `getUser()` round-trips to the auth server. Routes that gate a *service-role* client on `getSession()` were trusting an unverified claim. Count of routes still calling `getSession()`: **master 44 → branch 8**.

> **Incomplete:** these 8 routes still use `getSession()` on the branch — `my-boards`, `settings/delete-account`, `settings/leave-organization`, `settings/notifications`, `settings/profile`, `upload-model`, `user-profile`, `workspaces/[id]/archive`. They received only the `await supabaseServer()` change. `settings/*` and `user-profile` write profile data, so this is an unfinished hardening pass, not a deliberate exclusion.

**(iii) Admin gate centralized** — ad-hoc email checks replaced with `requireAdmin()`:

```diff
-import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
-import { isAdmin } from '@/lib/auth/isAdmin'
+import { supabaseServiceRole } from '@/lib/supabase/server'
+import { requireAdmin } from '@/lib/auth/requireAdmin'
...
-    const supabase = supabaseServer()
-    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
-    if (sessionError || !session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
-    if (!isAdmin(session.user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
+    const auth = await requireAdmin()
+    if (!auth.ok) return auth.response
```

`app/api/debug/boards/route.ts` and `debug/check-types/route.ts` additionally delete their own **duplicate local copies** of `ADMIN_EMAILS`/`isAdmin` — a real de-duplication.

### 4e. Behavioral (non-mechanical) API changes

These change what the server actually does and need the closest scrutiny.

#### `app/api/workspaces/[id]/join/route.ts` — joining now REQUIRES an invite code

```diff
+    if (workspace.type === 'personal' || !workspaceInviteMatches(workspace.type, workspace.invite_code, body?.inviteCode)) {
+      return NextResponse.json({ error: 'Invalid workspace invite' }, { status: 403 })
+    }
```

**What changed:** Previously any signed-in user could POST to join a `shared` workspace with no secret; the only gate was an email-domain check on `class` workspaces. Now the caller must present an `inviteCode` in the request body that matches the persisted `workspaces.invite_code`, and personal workspaces are unjoinable outright. **This is a real authorization fix, and it is also a breaking API contract change** — any client that calls join without `inviteCode` in the body now gets 403.

#### `app/api/workspaces/by-invite/[code]/route.ts` — legacy invite links stop working

```diff
-    // Backward compatibility: older workspaces may not have invite_code persisted.
-    // Accept the same 8-char fallback shown in settings (workspace ID prefix).
-    if (!workspace && inviteCode.length === 8) {
-      ...  // UUID-prefix range lookup + ilike prefix fallback
-    }
-    if (error || !workspace) {
+    if (error || !workspace || workspace.type === 'personal') {
```

**What changed:** The whole "first 8 characters of the workspace UUID works as an invite code" fallback is deleted, along with the URL-parsing `extractInviteCode` (replaced by strict `normalizeInviteCode`, regex `^[A-Z0-9-]{6,128}$`). Migration 037 backfills a real `invite_code` for rows that had none — **but any invite link already in circulation that used the ID-prefix form will now 404.** That is a user-visible regression for existing shared links, and it is not called out in the branch docs.

#### `app/api/workspaces/[id]/route.ts` — `canJoin` response removed, invite code owner-only

```diff
-      if (workspace.type === 'shared') {
-        if (workspace.invite_code) {
-          return NextResponse.json({ canJoin: true, id: ..., inviteCode: workspace.invite_code })
-        }
-        ...
-      }
       return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
...
-      inviteCode: workspace.invite_code || workspace.id.substring(0, 8).toUpperCase(),
+      inviteCode: isOwner ? workspace.invite_code || undefined : undefined,
```

**What changed:** A non-member hitting a shared workspace used to receive `{canJoin: true, inviteCode}` — i.e. **the API handed the invite secret to any non-member who asked.** That leak is closed. Two consequences: (1) any UI that routed on `canJoin` now just sees a 403; (2) `inviteCode` is only returned to the owner, so member-facing "share this code" UI goes blank.

#### `app/api/workspaces/route.ts` (POST) — org is no longer client-selectable

```diff
-    const institutionIdFromBody = body?.institution_id ?? null
-    const institutionSlugFromBody = body?.institution_slug?.trim() ?? null
...
-    if (type === 'class' && !(await isInstructorAccount(userId))) {
+    const { data: profile } = await supabaseAdmin.from('user_profiles')
+      .select('organization_id, account_role').eq('user_id', userId).maybeSingle()
+    if (type === 'class' && profile?.account_role !== 'instructor') {
...
-      organizationId: institutionId,
+      organizationId: type === 'class' ? profile?.organization_id ?? null : null,
```

**What changed:** Callers could previously pass `institution_id`/`institution_slug` and have the workspace stamped into that org (with a Wentworth default). Now the org is read server-side from the creator's own profile and **only applied to `class` workspaces**; shared/personal get `null`. Closes a cross-org write. Breaking for any caller still sending `institution_id`.

#### `app/api/rooms/[id]/route.ts` — publish gate tightened; room delete now cleans storage

```diff
-      if (body.isPublished === true && !(await isInstructorAccount(auth.userId))) {
+      if (body.isPublished === true) {
+        const { data: profile } = await admin.from('user_profiles')
+          .select('account_role, organization_id').eq('user_id', auth.userId).maybeSingle()
+        if (workspace.type !== 'class' || !workspace.organization_id
+          || profile?.account_role !== 'instructor'
+          || profile.organization_id !== workspace.organization_id) {
+          return NextResponse.json({ error: 'Only verified instructors can publish classes in their organization.' }, { status: 403 })
```

**What changed:** Publishing used to require only "is an instructor". Now it also requires the workspace be a `class`, have an `organization_id`, and that the instructor's org **match** it. An instructor can no longer publish a room in another org's class, nor publish a shared/personal room at all.

The `DELETE` handler additionally gains a paginated storage-cleanup pass — it inventories board object paths before the cascade, then re-scans **all** boards after and removes only paths nothing still references. Fails open (leaks an object) rather than risking deletion of a live object. Correct ordering, but note the post-delete scan reads the entire `boards` table in 1000-row pages on every room delete — an O(all boards) cost per delete.

#### `app/api/boards/duplicate/route.ts` — duplicates get their own storage objects

```diff
+    const copyPlan = buildBoardStorageCopyPlan(source.thumbnail_url, source.full_image_url, userId, newId)
+    for (const copy of copyPlan.copies) {
+      const { error: copyError } = await admin.storage.from('board-images').copy(copy.sourcePath, copy.destinationPath)
+      if (copyError) { /* roll back already-copied paths, 500 */ }
...
-      thumbnail_url: source.thumbnail_url,
-      full_image_url: source.full_image_url,
+      thumbnail_url: duplicatedThumbnailUrl,
+      full_image_url: duplicatedFullImageUrl,
```

**What changed:** This is the **highest-value fix on the branch.** Duplicating a board used to copy the source's storage URLs verbatim, so a copy and its source pointed at one object — deleting either could blank the other (the old comment in `boards/route.ts` records that "three boards were already destroyed this way"). Duplicates now get real copied objects under `{userId}/duplicates/{newBoardId}-N.ext`, with rollback of partial copies on both copy failure and insert failure. The aliasing guard in the DELETE path is **kept** and re-labelled "LEGACY ALIASING INVARIANT … until existing data is audited" — correct, since old aliased rows still exist in production.

#### `app/api/boards/route.ts` (POST) — storage-path ownership + anti-aliasing

```diff
+    if (!isOwnedBoardStoragePath(storagePath, userId)) {
+      return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
+    }
...
+    for (const objectUrl of new Set([fullUrl, thumbnailUrl])) {
+      for (const column of ['full_image_url', 'thumbnail_url'] as const) {
+        const { count, error: referenceError } = await admin.from('boards')
+          .select('id', { count: 'exact', head: true }).eq(column, objectUrl)
+        if (referenceError) { /* 500 — fail closed */ }
+        if ((count ?? 0) > 0) { return 409 'Storage object is already attached to a board' }
```

**What changed:** The client previously handed the server an arbitrary `storagePath` after a direct upload; the server attached it without checking the path belonged to the caller. Now the path must start with the caller's own `userId` segment (and reject `..`, `\`, leading `/`), and the URL must not already be attached to any board. Fails closed on query error. Closes a cross-user object-attachment hole.

#### `app/api/workspaces/[id]/export/route.ts` — SSRF fix

```diff
+      const storagePath = trustedBoardStoragePath(imgUrl, process.env.NEXT_PUBLIC_SUPABASE_URL)
+      if (!storagePath || !isOwnedBoardStoragePath(storagePath, board.owner_id)) {
+        return NextResponse.json({ error: `Board ${board.id} has an invalid storage object` }, { status: 422 })
+      }
-        const res = await fetch(imgUrl)
+        const { data, error: downloadError } = await adminDb.storage.from('board-images').download(storagePath)
```

**What changed:** Export used to `fetch()` whatever URL was stored in `full_image_url` — a stored value the server treated as a request target (server-side request forgery). It now validates origin/protocol/bucket-prefix against the configured Supabase URL (rejecting `http:`, embedded credentials like `https://project.supabase.co@evil.test/…`, and wrong buckets) and downloads through the storage client instead of a raw fetch.

#### `app/api/workspaces/[id]/route.ts` (DELETE) — storage cleanup on workspace delete

Adds a pre-delete inventory of board objects, wall-config JSON files, and 3D model paths referenced by those configs. If the inventory fails, **the workspace is not deleted** (500, retryable). After a successful DB delete, cleanup is best-effort and re-verifies against surviving boards/configs before removing anything. Ordering and fail-safety are right.

#### `app/api/feedback/route.ts` — rate limiting

```diff
+    const rateLimitSecret = process.env.FEEDBACK_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
+    if (!rateLimitSecret) { return 503 }
+    const identifier = feedbackSubmitterIdentifier(request, userId)
+    const hashedSubmitter = submitterHash(identifier, rateLimitSecret)
     const { error: insertError } = await supabaseServiceRole()
-      .from('feedback').insert({ message, user_id: userId, ... })
+      .rpc('submit_feedback', { p_message, p_user_id, p_user_email, p_page_url, p_submitter_hash })
+    if (insertError.message?.includes('feedback_rate_limited')) { return 429 }
```

**What changed:** Unauthenticated feedback was previously unlimited. Now every submission goes through the `submit_feedback` RPC (migration 038) which enforces 5-per-10-minutes per submitter hash under an advisory lock. The submitter identifier deliberately uses `x-vercel-forwarded-for` (platform-set) rather than the spoofable generic `X-Forwarded-For`. Message/page-URL validation moves into `lib/feedback/security.ts` (4000/2048 char caps, http(s)-or-local-path only).

> ⚠️ **Note:** the secret falls back to `SUPABASE_SERVICE_ROLE_KEY` when `FEEDBACK_RATE_LIMIT_SECRET` is unset. It is used only as an HMAC key (never transmitted), so this is not a leak — but it does mean rotating the service-role key silently resets every rate-limit bucket.

#### `app/api/admin/studios/[id]/membership/route.ts` — pre-existing bug preserved

```diff
-export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
+export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
+  const { id } = await params
   try {
```

Note `await params` was hoisted **outside** the `try` block here (and in several other routes). If `params` rejects, the error escapes the handler's own catch. Low practical risk, but it is a pattern repeated across `rooms/[id]`, `studios/[id]/view`, `network/*`, `workspaces/[id]/archive`.

### 4f. `lib/` changes

| File | Change |
|---|---|
| `lib/supabase/server.ts` | `supabaseServer()` async (§4c) |
| `lib/auth/requireAdmin.ts` | `await supabaseServer()` only |
| `lib/security/safeRedirect.ts` **(NEW)** | Rejects open redirects: requires leading `/`, blocks `//`, `\`, control chars, and re-checks after `decodeURIComponent`. Falls back to `/dashboard`. |
| `lib/feedback/security.ts` **(NEW)** | Feedback payload validation + HMAC-SHA256 submitter hashing (§4e). |
| `lib/workspaces/inviteCodes.ts` **(NEW)** | `normalizeInviteCode` (`^[A-Z0-9-]{6,128}$`), `workspaceInviteMatches` — personal always false. |
| `lib/workspaceUtils.ts` | **`Math.random()` → `crypto.getRandomValues()`** for invite codes (8 chars → 20 chars, ~100 bits) and workspace IDs. Real fix: invite codes were previously brute-forceable. |
| `lib/workspaces/createWorkspace.ts` | `if (type === 'shared')` → `if (type !== 'personal')` — class workspaces now also get a generated invite code (required by the new join gate). |
| `lib/storage/boardObjects.ts` **(NEW, 154 lines)** | Storage path extraction, ownership check, SSRF-safe URL validation, duplicate copy planning, reference collection. |
| `lib/storage/supabaseCleanup.ts` **(NEW, 80 lines)** | Paginated recursive storage listing, wall-config model-path loading, paginated board row loading. All service-role. |
| `lib/studioViewCache.ts` | Prefetch now takes `workspaceId` as a **third required arg** (wall-config is keyed by workspace, not room — the old call passed a room id and always fell back to defaults). Adds in-flight dedupe, a `cacheGeneration` counter so a `clearStudioViewCache()` during a flight discards the stale result, and **stops caching `boards: []` on a failed fetch** (that poisoned cache was clobbering real loads). Signature change — all callers must be updated. |
| `lib/useAccountMode.ts` | Effect `setState` calls deferred via `queueMicrotask` to satisfy React 19's `set-state-in-effect` rule; `loading` now returns `false` when there is no `userId`. |
| `lib/ProfileContext.tsx` | One `eslint-disable-next-line react-hooks/set-state-in-effect` comment. No behavior change. |
| `lib/design/tokens.ts` **(NEW)** | PinSpace color/radius/motion constants. |

### 4g. `hooks/useBoardUpload.ts`

```diff
-  user: any
+  user: User | null
-    studentName: options.user?.fullName || options.user?.firstName || '',
+    studentName: displayName,
```

**What changed:** The `user` prop was typed `any` and read **Clerk-shaped fields** (`fullName`, `firstName`) that a Supabase `User` object does not have — so `studentName`/`ownerName` were silently always empty/`'Anonymous'`. Now typed as `@supabase/supabase-js`'s `User` and reads `user_metadata.full_name` → `user_metadata.first_name` → email local-part. Genuine leftover-from-Clerk-migration bug. Also deletes two unused `cols`/`rows` locals.

### 4h. `components/3d/useBoardState.ts` — undo/redo now persists

```diff
-  const applySnapshot = useCallback((snapshot) => {
-    setBoardPositions(map)
-    setBoards(prev => prev.map(...))   // local only — never saved
-  }, [...])
+  const applySnapshot = useCallback(async (snapshot) => {
+    const updates = snapshotToPositionUpdates(snapshot, boardsRef.current)
+    const result = await updateBoardPositionsBulk(updates, { recordUndo: false })
+    if (result.failed > 0 || result.saved !== updates.length) {
+      toast.error('Could not save every restored board position. Try undo or redo again.')
+      return false
+    }
+    return true
+  }, [updateBoardPositionsBulk])
```

**What changed:** Undo/redo previously mutated only React state — the restored positions were **never written to the server**, so a refresh reverted them. Now both route through the same per-board write queue as drags, history advances only if every board saved, and a re-entrancy guard (`historyWriteInFlightRef`) blocks overlapping undo/redo. `undo`/`redo` become `async` — **callers that treat them as sync fire-and-forget need checking.** `updateBoardPositionsBulk` gains an `options.recordUndo` flag so a restore doesn't push its own undo entry.

### 4i. `scripts/cleanup-orphan-storage.ts` — destructive script hardened

Four changes, all in the safe direction: (1) new `--min-age-hours` floor (default **24h**) so an object uploaded seconds before its `boards` row isn't seen as an orphan — missing/invalid timestamps are **skipped**, not deleted; (2) storage listing paginates by `offset` instead of stopping at the first 1000 entries (previously it would under-list and, worse, under-*reference*); (3) list/download/parse failures now **throw** instead of `console.warn`+`continue` — previously an unreadable wall-config meant its referenced models looked unreferenced and got deleted; (4) references are **re-loaded and re-checked immediately before each delete batch**. Given the CLAUDE.md rule about never running this with `--apply` unattended, these are the right changes.

### 4j. Config files

| File | Change |
|---|---|
| `next.config.js` | Removes `eslint: { ignoreDuringBuilds: false }`. Next 16 no longer runs ESLint during `next build`, so this key is dead — but note the **`typescript.ignoreBuildErrors` safety net remains in place**, so a type error will still ship. |
| `tsconfig.json` | `"jsx": "preserve"` → `"react-jsx"`; adds `.next-dev/dev/types/**/*.ts` to `include`. |
| `.eslintrc.json` **(DELETED)** → `eslint.config.mjs` **(NEW)** | ESLint 9 flat config. Ports the `no-unused-vars` `^_` rules; **downgrades five `react-hooks/*` React-Compiler rules to `warn`** with a comment saying "React 18 and the imperative Three.js surfaces predate the React Compiler" — note the comment says React 18 while the branch ships React 19. `npm run lint` changes from `next lint` to `eslint . --max-warnings=0`, which **contradicts the CLAUDE.md rule to skip linting** and will fail on those warns. |
| `.vercelignore` | `+.env*` — stops local env files being uploaded to Vercel. Straightforwardly good. |
| `.env.example` | Documents `FEEDBACK_RATE_LIMIT_SECRET` (server-only, ≥32 bytes, falls back to service-role key). |
| `tailwind.config.js` | Palette moves from hard-coded hex to `rgb(var(--color-*) / <alpha-value>)` CSS vars; adds a `pinspace.*` brand palette; fonts switch to `var(--font-figtree)` / `var(--font-jetbrains-mono)`. Purely presentational, but every token now depends on `app/globals.css` defining those vars. |
| `package.json` scripts | Adds `typecheck`, `test`, `test:watch`, `test:e2e`, `test:a11y`, `test:visual`, `check:pinspace-ui`. |
| `CLAUDE.md` | Appends a Next.js-generated `<!-- BEGIN:nextjs-agent-rules -->` block (auto-written by `next dev`). Does not alter the project's own rules. |

### 4k. Database migrations

**`036_fix_board_reorder_text_ids.sql`** — Drops `reorder_room_boards(uuid, uuid[])` and recreates it as `(uuid, text[])`.
> `boards.id` is TEXT and upload-created ids look like `board-<timestamp>-<suffix>`. Migration 035 declared `p_ids` as `uuid[]`, so **valid board IDs could not reach the UPDATE** — board reordering was silently broken. Keeps the room-containment guard (`b.room_id = p_room_id`) and re-applies `revoke … from public, anon, authenticated` + `grant execute … to service_role`. Clean fix.

**`037_harden_profile_roles_and_invites.sql`** — Adds a `BEFORE INSERT OR UPDATE` trigger on `user_profiles` that raises `42501` if a browser (`anon`/`authenticated`) role tries to write `account_role`, `is_superadmin`, or `organization_id`. Also backfills `invite_code` for non-personal workspaces where it was NULL, using a 24-char `gen_random_uuid()`-derived code.
> ⚠️ **Compatibility risk:** the INSERT branch rejects any browser-side insert where `organization_id IS NOT NULL` or `account_role <> 'student'`. If the onboarding flow or `claim-domain` writes a profile with an org from the browser client rather than through an API route, that write will now fail with `42501`. Worth confirming against the onboarding path before applying.

**`038_rate_limit_feedback.sql`** — Adds `feedback.submitter_hash` + partial index, and a `SECURITY DEFINER` `submit_feedback(...)` RPC that validates message length (1–4000), page-URL length (≤2048), and hash length (=64), takes `pg_advisory_xact_lock(hashtextextended(hash))`, counts submissions in the last 10 minutes, raises `feedback_rate_limited` at ≥5, then inserts. Execute granted to `service_role` only. The advisory lock genuinely closes the check-then-insert race.

**`039_harden_workspace_room_board_authority.sql`** — Three `SECURITY DEFINER` triggers, all scoped to `anon`/`authenticated` only:
- `workspaces`: INSERT must have `owner_id = auth.uid()::text`; a `class` workspace requires the creator's profile to be `instructor` **and** the org to match theirs; non-class must have `organization_id IS NULL`; `is_public`/`published_at` must be false/null. UPDATE forbids changing `owner_id`, `organization_id`, `type`, `is_public`, `published_at`.
- `rooms`: forbids browser writes to `is_published` / `published_at`.
- `boards`: INSERT requires `owner_id = auth.uid()::text`, workspace ownership-or-membership, **non-null `room_id`**, and that the room belongs to the stated workspace. UPDATE forbids changing `owner_id`, `workspace_id`, `room_id`.

> These enforce in the DB what the API routes already enforce in app code — belt-and-braces defense against direct PostgREST writes. **But they are behavior-changing for any remaining browser-side write path.** Specifically: a browser-created board with a `NULL room_id` now hard-fails, and browser-side workspace creation of any kind now fails unless it exactly matches the trigger's expectations. Given the CLAUDE.md note that `workspaces.owner_id` is text while `user_profiles.user_id` is uuid, the `auth.uid()::text` casts look right, but this needs a real two-account test before it goes near production.

**Both `scripts/verify-*.sql`** are read-only verification queries meant to be run after applying 037/039. Neither mutates.

---

## 5. Specific checks — yes/no with evidence

### 5a. Any new or modified RLS policies? — **NO**

```
$ git diff master..origin/codex/kova-system-ui | grep -inE '^[+-].*(create +policy|alter +policy|drop +policy|row level security|force row level)'
(no matches)
```

Zero `CREATE POLICY`, `ALTER POLICY`, `DROP POLICY`, or `ENABLE ROW LEVEL SECURITY` lines anywhere in the diff. **This complies with the CLAUDE.md rule "do NOT add new RLS policies."** The migrations achieve their hardening with `BEFORE INSERT/UPDATE` triggers instead, which is a different mechanism and does not touch policy definitions.

Also checked: **no `ALTER PUBLICATION supabase_realtime` lines** — correct, because none of the four migrations creates a table.

### 5b. Any new migration files? — **YES, four**

| File | Status |
|---|---|
| `migrations/036_fix_board_reorder_text_ids.sql` | Added, 33 lines |
| `migrations/037_harden_profile_roles_and_invites.sql` | Added, 60 lines |
| `migrations/038_rate_limit_feedback.sql` | Added, 68 lines |
| `migrations/039_harden_workspace_room_board_authority.sql` | Added, 156 lines |

Detail in §4k. Per project rules these are **never auto-applied** — they must be pasted into the Supabase SQL Editor by hand. Note the ordering dependency: **038 must be applied before the new `app/api/feedback` code runs** (the route calls `submit_feedback`, which does not exist yet) and **037's invite backfill must be applied before the new join gate ships** (otherwise workspaces with a NULL `invite_code` become unjoinable).

### 5c. Any change to how `supabaseServiceRole` is called? — **YES, but no privilege expansion**

Every `+`/`-` line mentioning `supabaseServiceRole` in the whole diff:

```
-import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'   (×7 admin routes)
+import { supabaseServiceRole } from '@/lib/supabase/server'
+    const admin = supabaseServiceRole()      (moved earlier in boards/duplicate, rooms/[id], workspaces/[id])
-    const adminForRoomLookup = supabaseServiceRole()   (renamed to `admin`, reused)
+import { supabaseServiceRole } from '@/lib/supabase/server'   (lib/storage/supabaseCleanup.ts — new file)
+type AdminClient = ReturnType<typeof supabaseServiceRole>
```

**What this means:** the function itself (`lib/supabase/server.ts:supabaseServiceRole`) is **unchanged** — same env vars, same options, no new callers gaining privilege. The changes are (1) admin routes dropping the now-unused `supabaseServer` import because `requireAdmin()` handles verification, (2) hoisting a single `admin` client to the top of a handler instead of instantiating two, and (3) one new module (`lib/storage/supabaseCleanup.ts`) that takes an already-constructed admin client as a parameter.

**The important direction of travel is favorable:** every service-role call site is now gated on `auth.getUser()` (verified) or `requireAdmin()` rather than `auth.getSession()` (unverified). One of the new tests asserts exactly this:

```js
return source.includes('supabaseServiceRole') && source.includes('auth.getSession()')
```
(`tests/security/verified-admin-routes.test.ts` — flags any route combining the two.)

### 5d. Any new npm dependencies added to `package.json`? — **YES, 8 new devDependencies; 2 runtime deps removed**

**New (all `devDependencies`, all test tooling):**
- `@axe-core/playwright` `^4.13.0`
- `@playwright/test` `^1.62.1`
- `@testing-library/jest-dom` `^6.9.1`
- `@testing-library/react` `^16.3.2`
- `@testing-library/user-event` `^14.6.4`
- `@vitejs/plugin-react` `^4.7.0`
- `jsdom` `^24.1.3`
- `vitest` `^3.2.6`

**Removed (both were runtime `dependencies`):**
- `@supabase/auth-ui-react` `^0.4.7`
- `@supabase/auth-ui-shared` `^0.1.8`

**No new runtime dependencies were added.** Everything else in the `dependencies` block is a version bump of an existing package (§4a). `package-lock.json` churns 9,221 lines as a result. Several bumps pin **exact** versions rather than carets (`react`, `react-dom`, `@types/react`, `@react-three/fiber`, `@react-three/drei`, `framer-motion`) — deliberate, and sensible for a React 19 ecosystem where peer ranges are still settling.

### 5e. Any hardcoded URLs, keys, or credentials introduced? — **NO**

Credential scan across the full diff (excluding `package-lock.json`) for JWT-shaped strings, `sk_live`/`sk_test`, and assigned `api_key`/`password`/`service_role_key` literals:

```
$ git diff master..origin/codex/kova-system-ui -- . ':(exclude)package-lock.json' \
    | grep -nEi '^\+.*(eyJ[A-Za-z0-9_-]{10,}|sk_live|sk_test|service_role_key *= *[\x27"]|api[_-]?key *= *[\x27"][^\x27"]{8,}|password *= *[\x27"][^\x27"]{4,})'
(no matches)
```

**Zero hardcoded credentials.** Every added `http(s)://` literal outside `docs/` is inside a test file and is a deliberately fake host — `https://pinspace.test/...`, `https://example.test/...`, `https://project.supabase.co`, and adversarial fixtures like `https://evil.example` and `https://project.supabase.co@evil.test/...` that exist precisely to assert the new SSRF guard rejects them.

New `process.env` reads introduced: `FEEDBACK_RATE_LIMIT_SECRET` (documented in `.env.example`), `NEXT_PUBLIC_SUPABASE_URL` (already existed), `SUPABASE_SERVICE_ROLE_KEY` (already existed, used as HMAC fallback), plus `PLAYWRIGHT_*` / `CI` test-harness vars. `.vercelignore` additionally gains `.env*`, which **reduces** secret exposure.

### 5f. Any file deleted? — **YES, exactly one; plus one rename**

```
D   .eslintrc.json
R090 middleware.ts → proxy.ts
```

- **`.eslintrc.json`** — deleted, replaced by `eslint.config.mjs` (ESLint 9 requires flat config). Its rules were carried over.
- **`middleware.ts` → `proxy.ts`** — a rename (90% similarity), not a deletion. Git detects it with `-M`; without rename detection it would look like a delete + add. See §4b — this is the highest-risk single change on the branch.

No source, migration, or asset files were deleted. 111 files added, 175 modified.

---

## 6. New feature work (scope was "fixes only")

The branch is roughly **20% fixes and 80% new work**. Everything below is beyond a fixes-only scope.

### Tier 1 — Out of scope and highest risk

1. **Next.js 14 → 16 + React 18 → 19 major upgrade** (`4682372 "fix: upgrade secure framework baseline"`). Labelled `fix:`, but it is a two-major-version framework migration that forces the `params`-Promise rewrite of all 60 API routes, the async `supabaseServer()` refactor, the `middleware.ts` → `proxy.ts` rename, the ESLint 9 flat-config migration, and the R3F 8→9 / drei 9→10 / framer-motion 10→11 bumps. **This alone deserves its own branch, its own preview deploy, and its own smoke test.** It cannot be cherry-picked apart from the rest.

2. **Full "Kova" visual redesign of every route** — 10 `feat:` commits (`f36eb39`, `fdfb8ea`, `74ce6cf`, `d46eb77`, `9f47959`, `daa8644`, `426d2d6`, `71ead39`, `444fa2b`, `43902fe`) plus `122f9ff` and `308e11e`. Rewrites ~55 page files and ~30 components, introduces a new brand palette, and adds 20 new UI files. `app/workspace/[id]/page.tsx` alone changes 1,366 lines.

3. **New design-system layer** — `components/ui/{Primitives,Menu,Overlays,Tabs,Tooltip,index,utils}.tsx` (~900 lines), `components/layout/{AppShell,AppSidebar,MobileNav,PageHeader,StudioShell}.tsx`, `components/{auth,admin,public,discovery}/*Shell.tsx`, `lib/design/tokens.ts`, `components/3d/enginePalette.ts`. None of this existed before.

### Tier 2 — New infrastructure

4. **Vitest + Playwright test suite from scratch** — ~60 new test files, `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`, 6 new npm scripts, 8 new devDependencies. Valuable, but it is net-new infrastructure, and the E2E/a11y/visual suites need a running dev server (`next dev -H 127.0.0.1`) that the project's own rules discourage running here.

5. **Visual-regression PNG baselines committed to git** — `tests/visual/pinspace-routes.spec.ts-snapshots/{landing,sign-in,terms}.png`, **~871 KB of binary** (terms.png is 674 KB alone). These will re-churn on any font/renderer difference and are a poor fit for git.

6. **`scripts/check-pinspace-ui.mjs`** (300 lines) — a bespoke lint that bans off-palette hex values and obsolete component imports, with its own allow-list mechanism and its own 202-line test. Pure new tooling for the redesign.

7. **`components/3d/SceneErrorBoundary.tsx`** (82 lines) + test — new 3D crash-recovery UI, not a fix to an existing boundary.

### Tier 3 — Behavior changes that read as fixes but change the product

8. **Invite-code system redesign** — codes go 8 chars → 20 chars, `Math.random()` → `crypto`, `class` workspaces now get codes too, joining now *requires* the code, the ID-prefix fallback is deleted, and `inviteCode` is owner-only in API responses. The underlying `Math.random()` issue is a legitimate security fix, but the surrounding contract change is a feature-level redesign that **breaks invite links already in circulation** (§4e).

9. **Room-publish authorization tightened** to require class-type + org-match, and **workspace creation** no longer accepts a client-chosen institution. Both close real holes; both also change who can do what, so they need product sign-off, not just code review.

10. **Feedback rate limiting** (5 per 10 min) — a new product constraint with a new required env var and a new DB function.

11. **Three new DB triggers** (037, 039) enforcing server-managed columns. Defense in depth, but they can hard-fail existing browser-side write paths (§4k).

### Docs/noise

12. `docs/STATUS.md`, `docs/audit/2026-08-14-launch-readiness-audit.md`, and 5 `docs/plans/*.md` (~970 lines of planning docs), plus **`security_best_practices_report.md` committed to the repo root** rather than under `docs/`. The `CLAUDE.md` change is an auto-generated Next.js block, not an intentional rule edit.

---

## 7. Genuine fixes worth keeping (for reference)

If this branch is ever unbundled, these are the changes that stand on their own merit:

| Fix | Files | Why it matters |
|---|---|---|
| Board duplicate storage aliasing | `api/boards/duplicate`, `lib/storage/boardObjects.ts` | Deleting one board could blank another; three boards were already destroyed |
| `getSession()` → `getUser()` before service-role work | 52 of 60 API routes | Unverified JWT claims were gating RLS-bypassing clients |
| Board reorder RPC signature | `migrations/036` | `uuid[]` vs TEXT ids — reordering was silently a no-op |
| Undo/redo never persisted | `components/3d/useBoardState.ts` | Restored positions vanished on refresh |
| Export SSRF | `api/workspaces/[id]/export` | Server `fetch()`'d a stored, attacker-influenced URL |
| Storage-path ownership on board create | `api/boards` POST | Client could attach any path, including another user's |
| Invite codes from `Math.random()` | `lib/workspaceUtils.ts` | 8 chars of non-CSPRNG output |
| Invite code leaked to non-members | `api/workspaces/[id]` GET | `canJoin` response handed out the secret |
| Prefetch cached `boards: []` on failure | `lib/studioViewCache.ts` | Poisoned cache clobbered the real load |
| Clerk-shaped `user.fullName` reads | `hooks/useBoardUpload.ts` | Leftover from the Clerk→Supabase migration; names were always blank |
| Orphan-cleanup script deleting live objects | `scripts/cleanup-orphan-storage.ts` | Under-listing + swallowed errors made referenced objects look orphaned |
| `.env*` uploaded to Vercel | `.vercelignore` | Local secrets in the deployment bundle |

---

## 8. Notes and open questions

1. **Verification not run.** `npx tsc --noEmit` was **not** executed — type-checking this branch requires checking it out and installing `next@16`/`react@19`, both of which are outside the read-only constraint (and `npm install` was explicitly off-limits). Nothing here has been compiled or executed; all findings are from diff reading. Note that `next.config.js` still sets `typescript.ignoreBuildErrors`, so **a Vercel build succeeding is not evidence the types are clean.**

2. **`useSearchParams` + Suspense.** Per CLAUDE.md this only fails at Vercel build time, never at `tsc`. With ~55 rewritten page files this is a live risk that a preview deploy is the only way to catch.

3. **Migration/code ordering is load-bearing.** `038` must be applied before the feedback route ships (it calls an RPC that doesn't exist yet); `037`'s invite backfill must land before the new join gate, or NULL-`invite_code` workspaces become unjoinable. Applying `039` before verifying browser-side write paths could hard-fail board creation where `room_id` is null.

4. **`npm run lint` now runs `eslint . --max-warnings=0`.** The new flat config sets five `react-hooks/*` rules to `warn`, so this script will exit non-zero wherever those fire. This also conflicts with the project rule to skip linting entirely.

5. **Merge shape.** `45a4471` merges `codex/kova-system-ui` into itself and `2b41ab8` merges `master`. History is non-linear, so a `--first-parent` review would hide real changes.

### Suggested next step

Do not evaluate this as one unit. The framework upgrade (§6.1) and the redesign (§6.2) are independently large and independently risky; the security fixes (§7) are the part that actually matches "fixes only." If the fixes are what's wanted now, ask for them rebased onto `master` **without** the Next 16/React 19 bump — though note that some of them (`await params`, async `supabaseServer()`, `proxy.ts`) exist *only* because of that bump and would need reverting by hand. If the upgrade is wanted, it needs its own branch with a working Vercel preview before anything else lands on top.
