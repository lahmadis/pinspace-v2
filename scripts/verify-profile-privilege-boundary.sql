-- Run in the Supabase SQL Editor after migration 037. This transaction selects
-- one existing profile, impersonates that authenticated user, and proves a
-- direct privilege-column update is rejected by the database trigger.

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id FROM public.user_profiles ORDER BY created_at LIMIT 1),
    'role', 'authenticated'
  )::text,
  true
);

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    UPDATE public.user_profiles
    SET account_role = CASE account_role
      WHEN 'student' THEN 'instructor'
      ELSE 'student'
    END
    WHERE user_id = (SELECT auth.uid());

    RAISE EXCEPTION 'verification_failed: privilege update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: authenticated privilege update rejected';
  END;
END;
$$;

ROLLBACK;
