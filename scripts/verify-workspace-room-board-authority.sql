-- Run after migration 039 in a non-production Supabase SQL Editor. The entire
-- verification rolls back. It proves room/board authority fields cannot be
-- changed directly while ordinary room and board edits remain available to
-- the owning authenticated user.

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT owner_id FROM public.boards ORDER BY created_at LIMIT 1),
    'role', 'authenticated'
  )::text,
  true
);

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  target_board_id text := (SELECT id FROM public.boards WHERE owner_id = auth.uid()::text LIMIT 1);
  verification_workspace_id uuid;
  verification_room_id uuid;
BEGIN
  IF target_board_id IS NULL THEN
    RAISE EXCEPTION 'verification_requires_an_existing_board';
  END IF;

  BEGIN
    INSERT INTO public.workspaces (name, owner_id, type, organization_id)
    VALUES ('Migration 039 shared org check', auth.uid()::text, 'shared', gen_random_uuid());
    RAISE EXCEPTION 'verification_failed: shared workspace accepted an organization';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: shared workspace organization denied';
  END;

  BEGIN
    INSERT INTO public.workspaces (name, owner_id, type, organization_id)
    VALUES ('Migration 039 personal org check', auth.uid()::text, 'personal', gen_random_uuid());
    RAISE EXCEPTION 'verification_failed: personal workspace accepted an organization';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: personal workspace organization denied';
  END;

  INSERT INTO public.workspaces (name, owner_id, type)
  VALUES ('Migration 039 publication check', auth.uid()::text, 'personal')
  RETURNING id INTO verification_workspace_id;

  BEGIN
    UPDATE public.workspaces
    SET is_public = NOT is_public
    WHERE id = verification_workspace_id;
    RAISE EXCEPTION 'verification_failed: direct legacy workspace publication update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: direct legacy workspace publication update denied';
  END;

  INSERT INTO public.rooms (workspace_id, name)
  VALUES (verification_workspace_id, 'Migration 039 room insert check')
  RETURNING id INTO verification_room_id;

  UPDATE public.rooms
  SET name = 'Migration 039 renamed room', display_order = 1
  WHERE id = verification_room_id;
  RAISE NOTICE 'PASS: ordinary room insert and name/order update accepted';

  BEGIN
    UPDATE public.rooms
    SET is_published = true
    WHERE id = verification_room_id;
    RAISE EXCEPTION 'verification_failed: direct room is_published update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: direct room is_published update denied';
  END;

  BEGIN
    UPDATE public.rooms
    SET published_at = now()
    WHERE id = verification_room_id;
    RAISE EXCEPTION 'verification_failed: direct room published_at update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: direct room published_at update denied';
  END;

  UPDATE public.boards
  SET title = title, position_x = position_x
  WHERE id = target_board_id;
  RAISE NOTICE 'PASS: ordinary title and position update accepted';

  BEGIN
    UPDATE public.boards
    SET workspace_id = gen_random_uuid()
    WHERE id = target_board_id;
    RAISE EXCEPTION 'verification_failed: direct workspace parent update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: direct workspace parent update denied';
  END;

  BEGIN
    UPDATE public.boards
    SET room_id = gen_random_uuid()
    WHERE id = target_board_id;
    RAISE EXCEPTION 'verification_failed: direct room parent update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: direct room parent update denied';
  END;
END;
$$;

ROLLBACK;
