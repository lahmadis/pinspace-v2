# Fresh Supabase Bootstrap Implementation Plan

> **For Codex:** REQUIRED RELATED SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Produce one reviewed SQL bootstrap that can initialize a brand-new Supabase project for the current PinSpace application and seed its baseline organizations.

**Architecture:** Reconstruct the final schema from current API query contracts, historical base-table scripts, and numbered migrations. Consolidate those contracts into an idempotent, empty-project bootstrap rather than replaying historical migrations that depend on missing legacy tables. Keep schema application manual through the Supabase SQL Editor, per the repository's database-safety convention.

**Tech Stack:** PostgreSQL, Supabase Auth/RLS/Storage/Realtime, SQL, local PostgreSQL verification.

---

### Task 1: Create the consolidated bootstrap

**Files:**
- Create: `migrations/000_fresh_supabase_bootstrap.sql`

**Step 1: Define the final relational schema**

Create the current tables in dependency order: organizations, domains and requests; profiles; workspaces and memberships; rooms; boards and comments; sharing/critique tables; feedback.

**Step 2: Define database behavior**

Add constraints, indexes, updated-at triggers, board ordering, view counting, organization RPCs, and service-role-only privileged functions.

**Step 3: Define access controls**

Enable RLS, recreate final owner/member/public/organization policies, keep token and feedback tables service-role-only, and restrict permission-bearing profile columns from direct authenticated writes.

**Step 4: Configure Supabase integration**

Create the board-images and avatars buckets, storage policies, and safe Realtime publication membership.

**Step 5: Seed baseline rows**

Insert Wentworth and Northeastern plus their email-domain mappings using conflict-safe statements.

### Task 2: Repair the reusable seed script

**Files:**
- Modify: `scripts/seed_institutions_wentworth_northeastern.sql`

**Step 1: Target the current schema**

Replace writes to the removed institutions table with idempotent organizations and org_domains inserts.

### Task 3: Validate from a clean database

**Files:**
- Test: `migrations/000_fresh_supabase_bootstrap.sql`

**Step 1: Start disposable PostgreSQL**

Initialize a temporary local cluster and create lightweight mocks for Supabase-owned auth and storage objects.

**Step 2: Apply the bootstrap twice**

Run the file twice with `ON_ERROR_STOP=1`. Expected: both runs exit successfully and preserve exactly two baseline organizations and domains.

**Step 3: Verify contracts**

Query required tables, columns, foreign keys, functions, RLS status, storage buckets, publication membership, and profile column privileges.

**Step 4: Inspect and commit**

Review the touched-file diff and create a local Conventional Commit without pushing.
