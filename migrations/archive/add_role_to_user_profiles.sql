-- Add role (student/faculty) to user_profiles for admin stats.
-- Run once. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN role TEXT CHECK (role IN ('student', 'faculty'));
  END IF;
END $$;
