-- Migration 019: Widen workspaces.type CHECK constraint to include 'shared',
-- and add a partial unique index on invite_code for shared workspace lookup.

BEGIN;

ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_check
  CHECK (type IN ('class', 'personal', 'shared'));

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_invite_code_unique
  ON workspaces(invite_code) WHERE invite_code IS NOT NULL;

COMMIT;
