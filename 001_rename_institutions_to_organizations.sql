-- Phase 1, Migration 1: Rename institutions → organizations
-- Run in Supabase SQL Editor. Safe to inspect before running.
--
-- What this does:
--   1. Renames the institutions table to organizations
--      (PostgreSQL automatically updates FK constraints on workspaces and user_profiles)
--   2. Updates the type vocabulary: 'institution' → 'university'
--   3. Creates a read-only view named institutions for backward compatibility
--      (existing SELECT queries keep working; INSERT/UPDATE/DELETE through the view will
--       fail until Phase 4 updates those call sites — only affects POST /api/institutions,
--       which is admin-only and not in active use)
--
-- After running: verify with SELECT * FROM organizations; and SELECT * FROM institutions;

-- Step 1: Rename the table
ALTER TABLE institutions RENAME TO organizations;

-- Step 2: Drop the old check constraint (auto-named by Postgres when column was added inline)
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS institutions_type_check;

-- Step 3: Update existing type values to match new vocabulary
UPDATE organizations SET type = 'university' WHERE type = 'institution';

-- Step 4: Update the column default so new rows default to 'university'
ALTER TABLE organizations ALTER COLUMN type SET DEFAULT 'university';

-- Step 5: Add the new check constraint with correct vocabulary
ALTER TABLE organizations ADD CONSTRAINT organizations_type_check
  CHECK (type IN ('university', 'firm'));

-- Step 6: Create a read-only view under the old name for backward compat
CREATE OR REPLACE VIEW institutions AS
  SELECT * FROM organizations;
