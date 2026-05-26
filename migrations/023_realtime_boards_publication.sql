-- 023: Restore Realtime postgres_changes for the boards table.
--
-- The supabase_realtime publication had drifted to zero user tables (likely a
-- db/branch reset wiped its membership), so Postgres emitted no
-- INSERT/UPDATE/DELETE change events for boards. Effect: board uploads,
-- drag-end position moves, deletes, and edits did not reach other users in the
-- same room until a manual refresh. Re-add boards to the publication.
--
-- REPLICA IDENTITY FULL makes the `old` record in UPDATE/DELETE events carry
-- all columns (notably room_id). The studio-boards channel filters on
-- room_id=eq.{roomId}; without FULL, DELETE events (whose `old` would otherwise
-- hold only the primary key) can't be matched against that filter and are
-- dropped. WAL overhead is negligible at pilot scale.
ALTER PUBLICATION supabase_realtime ADD TABLE public.boards;
ALTER TABLE public.boards REPLICA IDENTITY FULL;
