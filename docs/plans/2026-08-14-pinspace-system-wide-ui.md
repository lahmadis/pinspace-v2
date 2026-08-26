# PinSpace System-Wide UI Implementation Plan

> **For Codex:** REQUIRED RELATED SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Replace the entire PinSpace interface with a production-ready, responsive, accessible PinSpace design in one coordinated release without changing existing product behavior or data contracts.

**Architecture:** Introduce semantic design tokens and a compact shared component layer, then migrate complete route groups onto those foundations behind an unreleased branch or release flag. Keep backend, Supabase, and 3D domain logic stable; separate oversized page presentation from behavior only where required to make the redesign safe and testable.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript, Tailwind CSS, Framer Motion, Lucide React, React Three Fiber, Supabase, Vitest, Testing Library, Playwright, axe-core.

---

## Release rule

This is a big-bang visual release. No partially migrated interface is deployed. Each task creates an internal checkpoint, but the release gate in Task 15 requires all routes and states to pass together.

### Task 1: Freeze the current behavior and route inventory

**Files:**
- Create: `docs/plans/pinspace-route-state-matrix.md`
- Create: `tests/e2e/current-behavior.spec.ts`
- Modify: `package.json`
- Create: `playwright.config.ts`

**Steps:**

1. Inventory every route under `app/`, its audience, authentication requirement, data dependency, loading state, empty state, error state, destructive action, modal, and responsive behavior.
2. Add Playwright and capture smoke journeys for landing, sign-in, onboarding, dashboard, network, workspace, studio, public sharing, critique, settings, and admin access control.
3. Run the journeys against the unchanged UI and record any pre-existing failures rather than silently treating them as redesign regressions.
4. Add screenshot checkpoints at 390, 768, 1440, and 1920 pixels for the major routes.
5. Run `npm run build` and the baseline browser suite. Expected: build passes and the route matrix distinguishes passing, blocked-by-environment, and pre-existing-failure states.
6. Commit: `refactor: capture pre-redesign behavior baseline`.

### Task 2: Establish automated UI quality gates

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/a11y/core-routes.spec.ts`
- Create: `tests/visual/pinspace-routes.spec.ts`

**Steps:**

1. Add scripts for type checking, unit tests, end-to-end tests, accessibility checks, and visual snapshots.
2. Configure Testing Library for component behavior and Playwright with axe-core for route-level accessibility checks.
3. Write a deliberately failing accessibility smoke test for the current dashboard to prove the gate detects violations.
4. Run the test and verify the expected failure.
5. Configure deterministic fonts, animations, seeded fixtures, and screenshot masking so visual tests are stable.
6. Commit: `refactor: add UI quality gates`.

### Task 3: Build the PinSpace token foundation

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.js` or the active Tailwind configuration file
- Modify: `app/layout.tsx`
- Create: `lib/design/tokens.ts`
- Create: `tests/design/tokens.test.ts`

**Steps:**

1. Write tests asserting the required semantic token names and approved PinSpace core values.
2. Run the token tests and verify they fail before implementation.
3. Add CSS variables for canvas, surface, raised surface, text, muted text, border, primary, secondary, success, warning, danger, focus, shadows, radii, spacing, and motion.
4. Load Figtree and JetBrains Mono through `next/font` so production does not depend on runtime font CDN requests.
5. Map semantic tokens into Tailwind and replace global legacy theme aliases without changing route markup yet.
6. Add `prefers-reduced-motion`, focus-visible, selection, scrollbar, and base typography rules.
7. Run token tests, type checking, and build. Expected: all pass with no route behavior change.
8. Commit: `feat: add PinSpace design tokens`.

### Task 4: Implement the shared component system

**Files:**
- Create: `components/ui/Button.tsx`
- Create: `components/ui/IconButton.tsx`
- Create: `components/ui/Input.tsx`
- Create: `components/ui/Select.tsx`
- Create: `components/ui/Card.tsx`
- Create: `components/ui/Badge.tsx`
- Create: `components/ui/Avatar.tsx`
- Create: `components/ui/Tabs.tsx`
- Create: `components/ui/Menu.tsx`
- Create: `components/ui/Dialog.tsx`
- Create: `components/ui/Sheet.tsx`
- Create: `components/ui/Tooltip.tsx`
- Create: `components/ui/Skeleton.tsx`
- Create: `components/ui/EmptyState.tsx`
- Create: `components/ui/StatusState.tsx`
- Modify: `components/ui/PasswordInput.tsx`
- Create: `tests/components/ui/*.test.tsx`

**Steps:**

1. Write behavior and keyboard tests for each interactive primitive, including focus restoration for dialogs and escape/outside-click behavior where appropriate.
2. Run the tests and verify they fail.
3. Implement the minimum variants required by the route matrix: primary, secondary, quiet, destructive, selected, loading, and disabled.
4. Ensure all primitives use semantic tokens and expose accessible labels and descriptions.
5. Run component tests and axe checks. Expected: no serious or critical violations.
6. Commit: `feat: build PinSpace UI primitives`.

### Task 5: Create the application shells and navigation

**Files:**
- Create: `components/layout/AppShell.tsx`
- Create: `components/layout/AppSidebar.tsx`
- Create: `components/layout/MobileNav.tsx`
- Create: `components/layout/PageHeader.tsx`
- Create: `components/layout/StudioShell.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx`
- Modify: `components/AvatarMenu.tsx`
- Create: `tests/components/layout/AppShell.test.tsx`

**Steps:**

1. Write tests for desktop navigation, mobile drawer behavior, active-route indication, focus containment, escape handling, and authenticated user controls.
2. Implement a cream/paper operational shell and a forest/transparent immersive studio shell.
3. Preserve all current navigation destinations and authorization-based visibility.
4. Verify layouts at 360, 768, 1024, and 1440 pixels with no horizontal overflow.
5. Commit: `feat: add PinSpace application shells`.

### Task 6: Redesign landing, authentication, recovery, and onboarding

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/sign-in/page.tsx`
- Modify: `app/sign-up/[[...sign-up]]/page.tsx`
- Modify: `app/forgot-password/page.tsx`
- Modify: `app/reset-password/page.tsx`
- Modify: `app/onboarding/page.tsx`
- Modify: `components/ui/PasswordInput.tsx`
- Create: `tests/e2e/auth-onboarding.spec.ts`

**Steps:**

1. Add failing browser tests for authentication entry points, validation, recovery, onboarding progress, keyboard operation, and mobile layout.
2. Rebuild the landing page around the PinSpace brand while preserving authenticated routing behavior.
3. Migrate all forms to shared primitives with visible labels, inline validation, submission states, and recovery guidance.
4. Test logged-out, loading, invalid-input, server-error, and success states.
5. Run auth tests, axe checks, and visual snapshots. Expected: all pass.
6. Commit: `feat: redesign PinSpace entry flows`.

### Task 7: Redesign dashboard and project management

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `components/dashboard/DashboardMain.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx`
- Modify: `components/dashboard/SuperadminOrgSwitcher.tsx`
- Modify: `components/JoinClassModal.tsx`
- Modify: `app/my-boards/page.tsx`
- Create: `tests/e2e/dashboard-projects.spec.ts`

**Steps:**

1. Write failing tests for scope navigation, project creation, joining, rename, archive, delete, leave, empty states, loading, and error recovery.
2. Implement the PinSpace dashboard hierarchy: clear page title, primary action, filter/scope navigation, project grid, and recent or contextual information only where existing data supports it.
3. Replace duplicated modal markup with shared dialogs while preserving API calls and confirmation semantics.
4. Verify destructive actions require explicit confirmation and return focus correctly.
5. Run dashboard behavior, responsive, accessibility, and snapshot tests.
6. Commit: `feat: redesign PinSpace dashboard`.

### Task 8: Redesign workspace creation and management

**Files:**
- Modify: `app/workspace/[id]/page.tsx`
- Modify: `app/workspace/new/page.tsx`
- Modify: `components/InstitutionCard.tsx`
- Modify: `components/admin/CreateStudioForm.tsx`
- Modify: `components/admin/InstructorPicker.tsx`
- Create: `tests/e2e/workspace-management.spec.ts`

**Steps:**

1. Write failing tests for workspace creation, room entry, membership visibility, validation, loading, empty states, and recoverable failures.
2. Apply the PinSpace operational layout and shared form/card components.
3. Preserve workspace and organization resolution logic unchanged.
4. Verify long names, large room collections, narrow screens, and permission-restricted controls.
5. Commit: `feat: redesign PinSpace workspaces`.

### Task 9: Redesign network, exploration, gallery, and profiles

**Files:**
- Modify: `app/network/page.tsx`
- Modify: `app/network/[workspaceId]/page.tsx`
- Modify: `app/network/shared/page.tsx`
- Modify: `app/network/wentworth/page.tsx`
- Modify: `components/network/NetworkView.tsx`
- Modify: `components/network/BubbleNetwork.tsx`
- Modify: `app/explore/page.tsx`
- Modify: `app/explore/[department]/page.tsx`
- Modify: `app/gallery/page.tsx`
- Modify: `components/Gallery3D.tsx`
- Modify: `components/GalleryAvatarModal.tsx`
- Modify: `app/u/[userId]/page.tsx`
- Create: `tests/e2e/network-discovery.spec.ts`

**Steps:**

1. Write failing tests for network navigation, node selection, back navigation, discovery filtering, gallery access, and public profiles.
2. Translate the PinSpace network concept into responsive SVG/HTML with semantic fallbacks and usable empty/loading/error states.
3. Add keyboard navigation and accessible summaries for information otherwise expressed only by graph position or color.
4. Ensure node colors come from accessible semantic/data-visualization tokens.
5. Run tests with small, large, and empty datasets at all target widths.
6. Commit: `feat: redesign PinSpace discovery`.

### Task 10: Redesign studio and immersive collaboration controls

**Files:**
- Modify: `app/studio/[id]/page.tsx`
- Modify: `app/studio/new/page.tsx`
- Modify: `components/3d/StudioRoom.tsx`
- Modify: `components/3d/EditModeOverlay.tsx`
- Modify: `components/3d/FloorEditorOverlay.tsx`
- Modify: `components/3d/PresenceBar.tsx`
- Modify: `components/3d/LaserPointer.tsx`
- Modify: `components/PinModeHeader.tsx`
- Modify: `components/CritModeHeader.tsx`
- Modify: `components/CommentPanel.tsx`
- Modify: `components/RightCommentPanel.tsx`
- Modify: `components/SideCommentPanel.tsx`
- Modify: `components/QuickNotePanel.tsx`
- Modify: `components/ShareModal.tsx`
- Create: `tests/e2e/studio-controls.spec.ts`

**Steps:**

1. Write failing tests for room switching, upload entry, sharing, comments, presentation, menu operation, edit modes, loading, connection failure, and restricted permissions.
2. Extract presentation-only toolbar and menu sections from the oversized studio page without changing realtime, board, camera, or persistence logic.
3. Implement the PinSpace immersive shell using compact paper/yellow controls over the 3D scene.
4. Provide keyboard and touch equivalents for pointer-only controls and honor reduced motion.
5. Verify controls do not obscure the canvas or browser safe areas on mobile and tablet.
6. Run studio regression tests, type checking, and targeted manual 3D checks.
7. Commit: `feat: redesign PinSpace studio experience`.

### Task 11: Redesign board, sharing, critique, and public surfaces

**Files:**
- Modify: `app/board/[id]/page.tsx`
- Modify: `app/share/[token]/page.tsx`
- Modify: `app/share/[token]/error.tsx`
- Modify: `app/crit/[token]/page.tsx`
- Modify: `app/crit/[token]/error.tsx`
- Modify: `app/f/[slug]/page.tsx`
- Modify: `app/i/[slug]/page.tsx`
- Modify: `components/LightboxModal.tsx`
- Modify: `components/PublishCategoryModal.tsx`
- Modify: `components/PublishConfirmModal.tsx`
- Create: `tests/e2e/public-sharing.spec.ts`

**Steps:**

1. Write failing tests for valid, invalid, expired, and permission-restricted links plus critique submission and board viewing.
2. Apply a distraction-free PinSpace public shell and shared status states.
3. Preserve token validation, content access, and mutation behavior exactly.
4. Verify unauthenticated mobile and keyboard experiences.
5. Commit: `feat: redesign PinSpace public flows`.

### Task 12: Redesign settings, admin, utility, and legal routes

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/institutions/page.tsx`
- Modify: `app/admin/users/page.tsx`
- Modify: `app/model/page.tsx`
- Modify: `app/demo/page.tsx`
- Modify: `app/debug/boards/page.tsx`
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Modify: `components/LegalDocument.tsx`
- Modify: `components/DemoBanner.tsx`
- Modify: `components/FeedbackButton.tsx`
- Create: `tests/e2e/secondary-routes.spec.ts`

**Steps:**

1. Write role and route-access tests before changing admin presentation.
2. Apply the operational PinSpace shell, tables, forms, banners, and legal typography.
3. Keep debug and demo affordances visually unmistakable and unavailable where current authorization forbids them.
4. Verify tables at mobile widths with an intentional responsive pattern rather than horizontal page overflow.
5. Commit: `feat: redesign PinSpace secondary routes`.

### Task 13: Unify global feedback and exceptional states

**Files:**
- Modify: `app/global-error.tsx`
- Modify: `components/Loading.tsx`
- Modify: `components/Toaster.tsx`
- Modify: `components/FeedbackButton.tsx`
- Modify: all route-local loading and error branches identified in `docs/plans/pinspace-route-state-matrix.md`
- Create: `tests/components/feedback-states.test.tsx`

**Steps:**

1. Add failing tests for loading announcements, toast focus behavior, retry actions, offline messaging, and global errors.
2. Replace inconsistent spinners and error cards with shared PinSpace status components.
3. Ensure async actions prevent duplicate submission and communicate progress to assistive technology.
4. Run state tests and visual snapshots for every state category.
5. Commit: `feat: unify PinSpace feedback states`.

### Task 14: Remove legacy styling and audit consistency

**Files:**
- Modify: all migrated files listed above
- Modify: `app/globals.css`
- Modify: active Tailwind configuration
- Create: `scripts/check-pinspace-ui.mjs`

**Steps:**

1. Add a check that flags unauthorized legacy indigo/purple theme classes, raw PinSpace palette literals outside token definitions, missing focus styles on custom interactive controls, and obsolete UI components.
2. Run the check and review every result manually; allowlist only intentional data-visualization colors with comments.
3. Remove unused legacy CSS and presentation-only components after confirming no imports remain.
4. Run `rg` checks for legacy branding, direct color literals, fixed 1440×900 layouts, and clickable non-semantic elements.
5. Run type checking, unit tests, and build.
6. Commit: `refactor: remove legacy interface styles`.

### Task 15: Execute the big-bang release gate

**Files:**
- Update: `docs/plans/pinspace-route-state-matrix.md`
- Create: `docs/plans/pinspace-release-checklist.md`

**Steps:**

1. Run formatting/linting, type checking, unit tests, production build, and the complete Playwright suite from a clean dependency install.
2. Run automated axe checks and manually verify keyboard-only navigation, focus order, screen-reader names, contrast, zoom to 200%, and reduced motion on core journeys.
3. Review every major route at 360, 390, 768, 1024, 1440, and 1920 pixels in Chromium, Firefox, and WebKit.
4. Compare approved screenshots with the PinSpace reference and resolve all unexplained visual differences.
5. Smoke-test authenticated and unauthenticated Supabase journeys against an isolated test project, including upload, rename, reorder, share, critique, comment, archive, delete, and permission denial.
6. Record performance baselines for landing, dashboard, network, and studio; investigate material regressions in loading, interaction responsiveness, bundle size, or 3D frame rate.
7. Test the rollback procedure and confirm no schema migration is required solely for the redesign.
8. Require product/design approval of the complete route matrix. Any P0/P1 defect, serious accessibility violation, broken core journey, or unexplained visual regression blocks release.
9. Commit: `refactor: complete PinSpace UI release validation`.

## Definition of done

- All routes in the route-state matrix are migrated and approved.
- No mixed legacy/PinSpace interface is reachable.
- Existing data and authorization behavior is unchanged and verified.
- Automated build, type, unit, browser, accessibility, and visual checks pass.
- Mobile, tablet, desktop, keyboard, touch, reduced-motion, and error-state reviews pass.
- A tested rollback path exists before the single production switch.
