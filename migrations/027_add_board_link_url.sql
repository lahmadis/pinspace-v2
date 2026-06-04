-- Migration 027: optional video link on a board.
--
-- A board's image acts as the cover; link_url is an optional external video
-- (YouTube, Vimeo, Loom, etc.) the uploader can attach to it. Nullable text —
-- boards with no link store NULL. Validation (must start with http:// or
-- https://, max 2048 chars, trimmed) lives in the API layer (see
-- lib/linkUrl.ts), shared by the client form and the server.
--
-- No realtime publication change: boards are already published (migration 023),
-- so adding a column flows through existing realtime UPDATE/INSERT events.

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS link_url TEXT;
