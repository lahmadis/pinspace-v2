-- Migration 13: Add requested_type to org_requests
-- Run in Supabase SQL Editor after 012_add_board_rotation.sql.
--
-- What this does:
--   Adds a requested_type column to org_requests so the requester can tell us
--   up-front whether they're from a university or a firm. The admin review
--   UI uses this to pre-select the type when creating the new org so we
--   don't default-guess 'university' for firm requesters.
--
--   Pre-existing rows default to 'university' — those were submitted before
--   firm-mode existed and were all university-context anyway.

ALTER TABLE org_requests
  ADD COLUMN IF NOT EXISTS requested_type TEXT NOT NULL DEFAULT 'university'
  CHECK (requested_type IN ('university', 'firm'));
