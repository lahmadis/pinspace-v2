# PinSpace Landing Source-of-Truth Implementation Plan

> **For Codex:** REQUIRED RELATED SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Match the approved PinSpace landing HTML precisely and preserve or repair every landing interaction before running the wider functionality gate.

**Architecture:** Replace only the `/` presentation while retaining its existing Supabase session subscription and gallery data flow. Use the existing PinSpace tokens and Figtree font, native links/buttons, and the existing account/menu and gallery primitives; add narrowly scoped tests before each behavior change.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Supabase Auth, Vitest/Testing Library, Playwright.

---

### Task 1: Lock the approved landing contract

**Files:**
- Modify: `tests/components/auth/entry-flows.test.tsx`
- Create: `tests/components/auth/landing-reference.test.tsx`

**Step 1: Write failing tests**

Assert the lowercase `pinspace.` heading, exact subtitle, two primary actions, auth-aware signed-out route, stable loading state, signed-in account menu, and absence of the retired marketing sections.

**Step 2: Run the focused tests to verify RED**

Run: Node 24 Vitest for the two landing suites.

Expected: failures against the current multi-section landing and old CTA labels.

### Task 2: Implement the exact responsive visual hierarchy

**Files:**
- Modify: `app/page.tsx`
- Modify if needed: `components/AvatarMenu.tsx`
- Modify if needed: `app/globals.css`

**Step 1: Implement the minimal presentation change**

Replace the existing header/hero/features/footer with the full-viewport yellow composition, responsive lowercase wordmark, subtitle, pill controls, and top-right account control. Reuse existing design tokens and font variables.

**Step 2: Run focused tests to verify GREEN**

Run the two landing suites and resolve only failures caused by the approved contract.

### Task 3: Repair landing functionality

**Files:**
- Modify: `app/page.tsx`
- Modify: `tests/components/auth/entry-flows.test.tsx`
- Modify: `tests/components/auth/landing-reference.test.tsx`

**Step 1: Add failing interaction tests**

Cover signed-out dashboard handoff with institution context, signed-in dashboard navigation, gallery modal open/submit/close, demo query preservation, account sign-out, loading announcement, and same-layout disabled state.

**Step 2: Verify RED, then implement minimally**

Keep existing auth and gallery data contracts. Fix only reproduced failures and verify the focused tests turn green.

### Task 4: Verify the rendered UI

**Files:**
- Modify: `tests/visual/pinspace-routes.spec.ts`
- Update after review: `tests/visual/pinspace-routes.spec.ts-snapshots/landing.png`
- Modify or create a focused landing Playwright spec only if existing coverage cannot express the approved behavior.

**Step 1: Run an isolated local route**

Inspect the rendered landing at 360, 768, 1024, 1440, and 1920 widths. Check exact typography/composition, no overflow, 200% zoom, focus order, hover states, account menu, dashboard handoff, and gallery dialog.

**Step 2: Review and regenerate the landing baseline**

Accept a new snapshot only after visual inspection confirms the approved HTML match.

### Task 5: Run the functionality and release regression gates

**Files:**
- Modify production files only for independently reproduced failures with a RED regression test first.

**Step 1: Run fresh gates**

Run the full Vitest suite, non-incremental typecheck, zero-warning lint, PinSpace UI/brand checks, targeted Chromium routes, accessibility, and visual tests using Node 24.

**Step 2: Diagnose any failure before fixing**

Trace each failure to its root cause, add a failing regression test, implement the smallest fix, and rerun the affected and full gates.

**Step 3: Record external limitations**

Keep live Supabase/migration-dependent checks explicit when production environment variables or migrations 036–039 are unavailable.

### Task 6: Review and deliver

**Files:**
- Inspect every touched file and its tests.

**Step 1: Request independent UI/functionality review**

Address validated P0–P2 findings test-first and request re-review.

**Step 2: Verify and commit**

Run the final focused/full gates, inspect `git status --short` and exact diffs, stage only personally touched paths, and create a local Conventional Commit. Do not push or deploy without a fresh explicit deployment request.
