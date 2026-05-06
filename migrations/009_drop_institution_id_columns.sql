-- Migration 009: Drop institution_id columns and the institutions view
-- Part 2 of P4.5 schema rename. Code now uses organization_id everywhere.

ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_institution_id_fkey;
ALTER TABLE workspaces DROP COLUMN IF EXISTS institution_id;

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_institution_id_fkey;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS institution_id;

DROP VIEW IF EXISTS institutions;
