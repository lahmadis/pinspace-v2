-- Migration 033: provenance for admin-provisioned workspaces.
--
-- For the WIT pilot, studios are created FOR professors by an admin rather than
-- by the professors themselves. The professor becomes the real owner
-- (workspaces.owner_id) so every owner-gated operation — publish, archive,
-- delete, network metadata, bulk enroll — works for them exactly as if they had
-- created it. That means owner_id can no longer tell you which studios were
-- seeded and which grew organically, so provenance needs its own column.
--
-- Stores the ADMIN'S user id, not a boolean: "which studios did we provision"
-- and "who provisioned this one" are both questions worth being able to answer,
-- and a boolean throws the second away for no saving. NULL = created organically
-- by its owner, which is every existing row.
--
-- TEXT to match workspaces.owner_id, which is TEXT because auth.uid() is
-- compared as text throughout this schema (see the RLS policies on workspaces).
-- No foreign key, for the same reason owner_id has none — auth.users.id is uuid
-- and the cast would have to live in the constraint.
--
-- No index: this is an admin-side filter over a table in the tens-to-hundreds of
-- rows, where a sequential scan is faster than an index lookup. Add one if
-- workspaces ever grows enough for that to stop being true.
--
-- No RLS change: workspaces already has its full policy set and a new column is
-- covered by the existing row-level policies. No realtime publication change:
-- workspaces is not published via postgres_changes (only boards and comments
-- are — migrations 023/024).
--
-- Backfill is deliberately absent. Every pre-existing workspace was created by
-- its own owner, and NULL already says that.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS created_by_admin TEXT;

COMMENT ON COLUMN workspaces.created_by_admin IS
  'Auth user id of the admin who provisioned this workspace on the owner''s behalf. NULL = created by its own owner.';
