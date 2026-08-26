-- Keep authorization-bearing profile fields server-managed and ensure every
-- joinable workspace has an unguessable persisted invite capability.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_user_profile_privilege_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  jwt_role text := coalesce((SELECT auth.role()), '');
BEGIN
  -- Direct SQL migrations and the service-role client remain able to manage
  -- authorization fields. Browser clients (anon/authenticated) may only write
  -- ordinary profile data.
  IF jwt_role IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND (
      NEW.account_role IS DISTINCT FROM 'student'
      OR NEW.is_superadmin IS DISTINCT FROM false
      OR NEW.organization_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'profile_privilege_columns_are_server_managed'
        USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' AND (
      NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.is_superadmin IS DISTINCT FROM OLD.is_superadmin
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    ) THEN
      RAISE EXCEPTION 'profile_privilege_columns_are_server_managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_protect_privilege_columns ON public.user_profiles;
CREATE TRIGGER user_profiles_protect_privilege_columns
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_user_profile_privilege_boundary();

-- Older class workspaces used the first eight characters of their id as an
-- invite. Replace that guessable fallback with a persisted 96-bit capability.
UPDATE public.workspaces
SET invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24))
WHERE invite_code IS NULL
  AND coalesce(type, 'class') <> 'personal';

COMMIT;

-- Verification (run after applying):
-- SELECT type, count(*) FILTER (WHERE invite_code IS NULL) AS missing_codes
-- FROM workspaces GROUP BY type;
-- Browser-authenticated INSERT/UPDATE attempts that change account_role,
-- is_superadmin, or organization_id must fail with SQLSTATE 42501.
