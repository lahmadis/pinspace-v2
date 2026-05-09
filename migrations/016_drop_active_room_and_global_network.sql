-- Migration 016: drop active_room_id and global-network columns (Pilot pass 5)
--
-- Pass 5 removed:
--  • The "Set as active" mechanic: workspaces.active_room_id was added in
--    migration 015 but never wired to any user-facing behavior beyond the
--    settings toggle that set it. Dead UI removed; column dropped here.
--  • The "Global Network" feature: rooms.is_globally_public and
--    workspaces.is_globally_public supported a global-publish concept that's
--    being removed entirely. Pilot scope is institution-only; if global
--    publishing returns it'll be redesigned from scratch.
--
-- workspaces.is_public, workspaces.published_at, workspaces.network_metadata
-- and rooms.published_at are intentionally NOT dropped here — is_public is a
-- deprecated column scheduled for a separate cleanup migration, and the
-- published_at timestamps remain useful metadata.

ALTER TABLE workspaces
  DROP COLUMN IF EXISTS active_room_id;

ALTER TABLE workspaces
  DROP COLUMN IF EXISTS is_globally_public;

ALTER TABLE rooms
  DROP COLUMN IF EXISTS is_globally_public;
