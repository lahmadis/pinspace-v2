-- 041 — "shared" stops being a workspace TYPE and becomes a derived state.
--
-- A space was created as one of three types: 'class', 'shared' or 'personal',
-- and the dashboard had a tab per type. But 'shared' was never a different kind
-- of thing from 'personal' — it was a personal space that happened to have
-- someone else in it, declared up front at creation time. That forced a
-- decision before it could be made ("will I share this?") and stranded the
-- answer if it changed: a personal space you later invited someone into stayed
-- filed as personal, and a shared space nobody joined stayed filed as shared.
--
-- Shared is now derived, at read time, from the only fact that actually means
-- it: the space has a member who is not its owner. Nothing declares it and
-- nothing has to be kept in sync.
--
-- This collapses the 9 existing type='shared' rows into 'personal'. It is
-- LOSSLESS: every one of them already has members, so every one of them still
-- reads as shared afterward — the flag was redundant with the membership rows
-- it duplicated. The dashboard tolerates either value in the meantime (it
-- filters on `type <> 'class'`), so applying this is not urgent and the app is
-- not broken before it runs.
--
-- Reversible in the sense that matters: re-deriving the old column is
-- `UPDATE workspaces SET type='shared' WHERE type='personal' AND id IN
-- (SELECT workspace_id FROM workspace_members GROUP BY workspace_id HAVING ...)`.
-- The rows themselves are untouched.

BEGIN;

UPDATE workspaces
SET type = 'personal'
WHERE type = 'shared';

COMMIT;

-- Verify: expect zero rows.
-- SELECT id, name FROM workspaces WHERE type = 'shared';
