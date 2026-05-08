-- Migration 015: workspaces.active_room_id (Phase 6.2a)
--
-- Owners can flag which room in a workspace is currently accepting uploads.
-- The Phase 6.2b upload UI will use this as the default in its room picker;
-- the Phase 6.2a settings UI exposes the toggle to set it.
--
-- ON DELETE SET NULL so deleting a room (which already cascades to its boards
-- via migration 014's boards.room_id FK) doesn't fail the workspaces row —
-- workspace just goes back to "no active room" and the picker falls back to
-- the first room by display_order.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN active_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

COMMIT;
