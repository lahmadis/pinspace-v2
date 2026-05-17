-- Delete all data for a user by email (for testing: start fresh with same email).
-- Replace 'lahmadis@wit.edu' with the email to remove.
-- Run in Supabase SQL Editor.
--
-- If DELETE FROM auth.users fails (permission denied), run only the first 3 deletes
-- below, then go to Dashboard → Authentication → Users → find the user → Delete.

DO $$
DECLARE
  target_email TEXT := 'lahmadis@wit.edu';
  uid UUID;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = target_email;

  IF uid IS NULL THEN
    RAISE NOTICE 'No user found with email: %', target_email;
    RETURN;
  END IF;

  -- Remove from workspace_members (so they're not a member of any workspace)
  DELETE FROM workspace_members WHERE user_id = uid::text;

  -- Delete workspaces they own (boards and comments cascade)
  DELETE FROM workspaces WHERE owner_id = uid::text;

  -- Delete their profile
  DELETE FROM user_profiles WHERE user_id = uid;

  -- Delete the auth user (this lets them sign up again with same email)
  DELETE FROM auth.users WHERE id = uid;

  RAISE NOTICE 'Deleted all data for: %', target_email;
END $$;
