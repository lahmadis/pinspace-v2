-- Keep organization, publication, and board-parent authority server-managed.
-- Application mutation routes authenticate and authorize the caller, then use
-- the service-role client. Browser-authenticated PostgREST writes must not be
-- able to bypass those route boundaries.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_workspace_authority_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  jwt_role text := coalesce((SELECT auth.role()), '');
  owner_account_role text;
  owner_organization_id uuid;
BEGIN
  IF jwt_role IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.owner_id IS DISTINCT FROM auth.uid()::text THEN
        RAISE EXCEPTION 'workspace_owner_must_match_authenticated_user'
          USING ERRCODE = '42501';
      END IF;

      IF coalesce(NEW.type, 'class') = 'class' THEN
        SELECT profile.account_role, profile.organization_id
        INTO owner_account_role, owner_organization_id
        FROM public.user_profiles AS profile
        WHERE profile.user_id = auth.uid();

        IF owner_account_role IS DISTINCT FROM 'instructor'
          OR NEW.organization_id IS DISTINCT FROM owner_organization_id THEN
          RAISE EXCEPTION 'class_workspace_requires_verified_instructor_organization'
            USING ERRCODE = '42501';
        END IF;
      ELSIF coalesce(NEW.type, 'class') <> 'class' AND NEW.organization_id IS NOT NULL THEN
        RAISE EXCEPTION 'non_class_workspace_cannot_have_an_organization'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.is_public IS DISTINCT FROM false OR NEW.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'workspace_publication_columns_are_server_managed'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.is_public IS DISTINCT FROM OLD.is_public
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR (coalesce(NEW.type, 'class') <> 'class' AND NEW.organization_id IS NOT NULL) THEN
      RAISE EXCEPTION 'workspace_authority_columns_are_server_managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_protect_authority_columns ON public.workspaces;
CREATE TRIGGER workspaces_protect_authority_columns
  BEFORE INSERT OR UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workspace_authority_boundary();

CREATE OR REPLACE FUNCTION public.enforce_room_publication_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  jwt_role text := coalesce((SELECT auth.role()), '');
BEGIN
  IF jwt_role IN ('anon', 'authenticated') THEN
    IF (TG_OP = 'INSERT' AND (
      NEW.is_published IS DISTINCT FROM false
      OR NEW.published_at IS NOT NULL
    )) OR (TG_OP = 'UPDATE' AND (
      NEW.is_published IS DISTINCT FROM OLD.is_published
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
    )) THEN
      RAISE EXCEPTION 'room_publication_columns_are_server_managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_protect_publication_columns ON public.rooms;
CREATE TRIGGER rooms_protect_publication_columns
  BEFORE INSERT OR UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_room_publication_boundary();

CREATE OR REPLACE FUNCTION public.enforce_board_parent_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  jwt_role text := coalesce((SELECT auth.role()), '');
BEGIN
  IF jwt_role IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.owner_id IS DISTINCT FROM auth.uid()::text
        OR NOT EXISTS (
          SELECT 1
          FROM public.workspaces AS w
          WHERE w.id = NEW.workspace_id
            AND (
              w.owner_id = auth.uid()::text
              OR EXISTS (
                SELECT 1
                FROM public.workspace_members AS wm
                WHERE wm.workspace_id = w.id
                  AND wm.user_id = auth.uid()::text
              )
            )
        )
        OR NEW.room_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.rooms AS r
          WHERE r.id = NEW.room_id
            AND r.workspace_id = NEW.workspace_id
        ) THEN
        RAISE EXCEPTION 'board_parent_requires_workspace_membership_and_matching_room'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.room_id IS DISTINCT FROM OLD.room_id THEN
      RAISE EXCEPTION 'board_parent_columns_are_server_managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- All ordinary board title and position updates remain allowed; the existing
  -- UPDATE RLS policy continues to require ownership for those fields.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boards_protect_parent_columns ON public.boards;
CREATE TRIGGER boards_protect_parent_columns
  BEFORE INSERT OR UPDATE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_board_parent_boundary();

COMMIT;

-- Verification after applying: run scripts/verify-workspace-room-board-authority.sql.
