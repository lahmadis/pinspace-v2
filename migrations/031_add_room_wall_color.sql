-- Migration 031: room-level wall color.
--
-- A room's walls render either 'grey' (the current default look — a very light
-- blue-leaning tone) or 'white'. This is a DEDICATED column, deliberately NOT
-- part of the wall-config JSON blob, so it never touches the wall-config save
-- path, its version/optimistic-concurrency checks, or Save & Exit. The 3D
-- renderer reads it off the room; the owner toggles it from workspace settings.
--
-- Constrained to the two supported values at the DB layer; the API re-validates
-- the same set. Existing rooms adopt 'grey' via the default — no backfill.
--
-- No realtime publication change: `rooms` is not published via postgres_changes
-- (only `boards` and `comments` are — migrations 023/024), so no ALTER
-- PUBLICATION is required here.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS wall_color TEXT NOT NULL DEFAULT 'grey'
  CHECK (wall_color IN ('grey', 'white'));
