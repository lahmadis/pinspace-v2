-- Migration 010: Add archive support to workspaces

BEGIN;

ALTER TABLE workspaces ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX workspaces_is_archived_idx ON workspaces(is_archived) WHERE is_archived = true;

CREATE POLICY "Cannot insert boards into archived workspaces"
  ON boards FOR INSERT
  WITH CHECK (
    workspace_id NOT IN (SELECT id FROM workspaces WHERE is_archived = true)
  );

CREATE POLICY "Cannot insert comments on archived workspace boards"
  ON comments FOR INSERT
  WITH CHECK (
    board_id NOT IN (
      SELECT id FROM boards WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE is_archived = true
      )
    )
  );

COMMIT;
