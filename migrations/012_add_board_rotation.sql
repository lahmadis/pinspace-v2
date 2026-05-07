-- Migration 012: board rotation in 2D wall edit mode.
--
-- Stored in radians (Three.js native — no conversion at render time).
-- 0 = unrotated; positive = counter-clockwise around the board's center.
-- The render group applies this as `rotation.z`.
--
-- (Filename uses 012 because 008 was taken by 008_add_organization_id_columns.sql.)

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS position_rotation NUMERIC NOT NULL DEFAULT 0;
