-- Migration 022: add account_role permission column to user_profiles.
--
-- Why: signup/onboarding let users self-select a demographic role
-- (student/faculty/professional). That demographic `role` column granted no
-- power, but workspace creation and room publishing were ungated — any user
-- could spin up an institution-facing classroom and publish it to the network.
-- This adds a dedicated PERMISSION field, separate from the demographic `role`,
-- so the only way to become an instructor is for an admin to promote you via
-- the admin users page. The demographic `role` column is intentionally left
-- untouched (its 'professional' CHECK bug is a separate phase).
--
-- Default is 'student' (least privilege). Backfill grants 'instructor' to users
-- who are already acting as instructors today: anyone whose demographic role is
-- 'faculty', OR who already owns at least one workspace (they were auto-added as
-- the workspace 'instructor' member on creation). Everyone else stays 'student';
-- the admin can audit and demote via the new admin page.

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS account_role TEXT NOT NULL DEFAULT 'student';

-- Add the CHECK separately + idempotently (ADD COLUMN can't IF-NOT-EXISTS a constraint).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_account_role_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_account_role_check
      CHECK (account_role IN ('student', 'instructor'));
  END IF;
END $$;

-- Backfill existing instructors (faculty OR current workspace owners).
UPDATE user_profiles p
SET account_role = 'instructor'
WHERE p.account_role <> 'instructor'
  AND (
    p.role = 'faculty'
    OR EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = p.user_id)
  );

COMMIT;

-- Verification (run separately after applying):
-- SELECT account_role, count(*) FROM user_profiles GROUP BY account_role;
-- Expect: a mix of 'student' and 'instructor'; no NULLs; no other values.
