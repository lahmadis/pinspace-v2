-- ---------------------------------------------------------------------------
-- 037 — canvas_nodes: drop the public and org SELECT policies.
--
-- WHY
--
-- Migration 036 copied the board_traces SELECT set from 030 wholesale: owner,
-- member, public-workspace, org-workspace. That was the wrong template for this
-- table. Board traces are redlines ON a board, and a published space is meant to
-- show its boards; canvas content is the working record of a desk crit — voice
-- notes, half-formed next steps, an instructor's marks on a student's work.
--
-- Those two extra policies meant an anonymous reader could pull canvas_nodes
-- straight from PostgREST for ANY published workspace, and any member of the
-- same institution could do the same for org workspaces, without ever touching
-- the API. lib/canvas/access.ts grants neither — it is owner OR member OR
-- superadmin, or a room-scoped guest token — so the database was strictly more
-- permissive than the code that claims to be the gate.
--
-- WHAT THIS COSTS
--
-- Nothing for guests: they authenticate with a link, not an account, so they
-- receive no postgres_changes either way (036's own header says so). Realtime
-- for owners and members is untouched — those two policies remain, and they are
-- the ones auth.uid() can actually satisfy.
--
-- The SELECT policies that remain still grant no write access; canvas_nodes has
-- no INSERT/UPDATE/DELETE policy at all, so every write continues to go through
-- the service-role client behind the app-code check, per CLAUDE.md.
--
-- Per CLAUDE.md this file is NOT auto-applied. Paste it into the Supabase SQL
-- Editor.
-- ---------------------------------------------------------------------------

BEGIN;

-- Names must match 036 exactly or these are silent no-ops. DROP ... IF EXISTS
-- does not error on a name that was never created, which is what makes a typo
-- here dangerous rather than loud.
DROP POLICY IF EXISTS "Anyone can view canvas_nodes in public workspaces" ON canvas_nodes;
DROP POLICY IF EXISTS "Org members can view canvas_nodes in org workspaces" ON canvas_nodes;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification — expect exactly two rows, the owner and member policies:
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'canvas_nodes' ORDER BY policyname;
--
-- If four come back, the DROPs did not match the names in 036.
-- ---------------------------------------------------------------------------
