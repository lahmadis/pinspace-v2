-- Allow 'professional' (professional working at a firm) in user_profiles.role.
-- Run once. Safe to re-run: drops old check and adds new one.

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('student', 'faculty', 'professional'));
