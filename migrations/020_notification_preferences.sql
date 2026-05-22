-- Migration 020: Notification preferences and soft-delete support for user_profiles
-- Also adds avatar_url (store uploads in the 'avatars' Supabase Storage bucket — create it
-- as a public bucket if it doesn't already exist before testing avatar uploads).

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notify_room_invites     BOOLEAN    NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_platform_updates BOOLEAN    NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at              TIMESTAMPTZ         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_url              TEXT                DEFAULT NULL;

COMMIT;
