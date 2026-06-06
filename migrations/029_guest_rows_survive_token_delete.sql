-- Migration 029: Let guest critique rows SURVIVE guest_tokens deletion (Phase A.5).
--
-- board_comments.guest_token_id and board_traces.guest_token_id already FK to
-- guest_tokens(id) ON DELETE SET NULL, so deleting a token NULLs the link rather
-- than cascading the rows away. BUT both tables also carry an author_chk:
--     CHECK (author_id IS NOT NULL OR guest_token_id IS NOT NULL)
-- For a guest-authored row author_id is NULL, so the SET NULL would leave BOTH
-- identity columns NULL and VIOLATE the check — aborting the token DELETE.
--
-- author_name is NOT NULL on both tables and is the real display anchor (the
-- guest's name is captured on the row at write time), so an orphaned guest row
-- is still fully renderable. Drop the now-too-strict checks to permit orphaning.
-- Insert-time identity is still guaranteed by the application code, which always
-- sets exactly one of author_id / guest_token_id.

ALTER TABLE public.board_comments DROP CONSTRAINT IF EXISTS board_comments_author_chk;
ALTER TABLE public.board_traces   DROP CONSTRAINT IF EXISTS board_traces_author_chk;
