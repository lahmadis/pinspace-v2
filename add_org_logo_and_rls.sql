-- 1. Add logo_url to institutions
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. SECURITY DEFINER helper — reads user_profiles without causing RLS recursion
--    (user_profiles RLS only checks auth.uid() = user_id, no cross-table dependency)
CREATE OR REPLACE FUNCTION public.get_my_institution_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM user_profiles WHERE user_id = auth.uid()
$$;

-- 3. Workspace org-visibility policy (additive — keeps existing owner + public policies)
CREATE POLICY "Org members can view org workspaces"
ON workspaces FOR SELECT
USING (
  institution_id IS NOT NULL
  AND institution_id = get_my_institution_id()
);

-- 4. Boards org-visibility policy (additive)
CREATE POLICY "Org members can view boards in org workspaces"
ON boards FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces
    WHERE institution_id IS NOT NULL
      AND institution_id = get_my_institution_id()
  )
);

-- 5. Comments org-visibility policy (additive)
--    Matches existing pattern in FIX_comments_rls_for_public.sql
CREATE POLICY "Org members can view comments on org boards"
ON comments FOR SELECT
USING (
  board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces
      WHERE institution_id IS NOT NULL
        AND institution_id = get_my_institution_id()
    )
  )
);
