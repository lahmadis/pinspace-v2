# PinSpace Reusable UI System Implementation Plan

> **For Codex:** REQUIRED RELATED SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Complete the reusable PinSpace UI system, migrate the highest-duplication product surfaces, preserve behavior, and deploy the verified result to Vercel.

**Architecture:** Extend the existing dependency-free `components/ui` primitives rather than introduce another component library. Build accessible compound components for forms, cards, actions, tables, and page states; migrate admin and comment surfaces first because they contain the highest measured duplication. Keep complex 3D/media behavior unchanged and extract only tested presentation seams.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Supabase, Vitest/Testing Library, Playwright, Vercel.

---

### Task 1: Complete foundational primitives

**Files:**
- Modify: `components/ui/Primitives.tsx`
- Modify: `components/ui/index.ts`
- Test: `tests/components/ui/system-components.test.tsx`

**Steps:**
1. Write failing tests for `ButtonLink`, `Textarea`, compound form fields, checkbox/switch semantics, compound cards, spinner, and reusable action rows.
2. Run the focused suite and confirm failures are caused by missing exports.
3. Implement the smallest accessible, token-based primitives without changing existing primitive APIs.
4. Rerun focused tests, the existing primitive suite, typecheck, and scoped lint.

### Task 2: Add the shared data-table system

**Files:**
- Create: `components/ui/DataTable.tsx`
- Modify: `components/ui/index.ts`
- Test: `tests/components/ui/data-table.test.tsx`

**Steps:**
1. Write failing tests for labelled horizontal regions, semantic headers, empty/loading/error rows, row actions, and responsive containment.
2. Confirm RED against the missing component.
3. Implement compound table primitives that preserve native table semantics.
4. Confirm GREEN and run accessibility-focused component tests.

### Task 3: Migrate admin forms, cards, actions, and tables

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/users/page.tsx`
- Modify: `app/admin/institutions/[slug]/page.tsx`
- Modify: `app/admin/instructors/[userId]/page.tsx`
- Test: `tests/components/secondary/SecondaryComponents.test.tsx`
- Test: `tests/components/secondary/SecondarySourceContracts.test.ts`

**Steps:**
1. Add characterization tests for current labels, pending guards, table headings, empty/error states, and action names.
2. Confirm the new source-contract expectations fail on duplicated raw structures.
3. Replace repeated table wrappers/cells, raw form fields, link actions, badges, and card shells with shared components while preserving API calls and permissions.
4. Rerun focused admin tests, typecheck, and scoped lint.

### Task 4: Consolidate comment interfaces

**Files:**
- Create: `components/comments/useCommentThread.ts`
- Create: `components/comments/CommentThread.tsx`
- Modify: `components/CommentPanel.tsx`
- Modify: `components/RightCommentPanel.tsx`
- Modify: `components/SideCommentPanel.tsx`
- Test: `tests/components/comments/comment-thread.test.tsx`

**Steps:**
1. Add failing characterization tests for loading, error/retry, empty, posting, archived/read-only state, focus return, and existing endpoint payloads.
2. Extract shared data/state logic and accessible presentation with adapters for left/right/inline layouts.
3. Preserve every endpoint, realtime nonce, author-name rule, pending guard, and toast behavior.
4. Run focused comment/public/studio suites and typecheck.

### Task 5: Add reusable-system enforcement and route coverage

**Files:**
- Modify: `scripts/check-pinspace-ui.mjs`
- Modify: `tests/scripts/check-pinspace-ui.test.ts`
- Modify: `tests/a11y/core-routes.spec.ts`
- Create: `tests/components/ui/component-catalog.test.tsx`

**Steps:**
1. Add failing fixtures for newly prohibited ad-hoc table wrappers and raw general-purpose form controls in migrated application files.
2. Add a test-only component catalogue rendering all primitive states and long-label cases.
3. Expand accessibility coverage to representative admin/table/dialog states without weakening existing rules.
4. Run the policy, component, accessibility, and responsive gates.

### Task 6: Verify, review, commit, and deploy

**Files:**
- Inspect every touched path and update release evidence only with fresh counts.

**Steps:**
1. Run focused tests, full Vitest, nonincremental TypeScript, zero-warning ESLint, PinSpace UI policy, `git diff --check`, and targeted Chromium/a11y/visual tests.
2. Inspect the complete diff and confirm no API, auth, permission, or 3D behavior changed unintentionally.
3. Stage only touched paths and create a local Conventional Commit.
4. Deploy the verified committed tree to Vercel and report the deployment URL plus remaining external Supabase prerequisites.
