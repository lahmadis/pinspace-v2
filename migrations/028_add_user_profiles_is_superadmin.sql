-- Migration 028: platform superadmin flag on user_profiles.
--
-- A superadmin has READ-ONLY access to ANY organization's network (published-
-- to-network content) — in addition to their own org membership. The flag is
-- the single source of truth, read server-side via service role from the
-- authenticated user id (never trusted from a client header/param/body).
--
-- No realtime publication change. Access is enforced in app code (service-role
-- reads), consistent with the existing pattern — RLS policies are not modified.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false;
