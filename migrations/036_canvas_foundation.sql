-- Migration 036: Canvas foundation — infinite canvas surfaces and their nodes.
--
-- Phase 1 of the desks feature. This is the data model only; the viewport,
-- tools and multiplayer client build on top of it. The schema lands first and
-- alone because it is the expensive thing to change once real canvases exist.
--
--
-- WHY ONE ROW PER NODE, NOT A JSON DOCUMENT
--
-- The obvious alternative is to store a canvas as a single JSONB blob, the way
-- wall-config does. That model already needs a single-writer queue with
-- optimistic concurrency and rebase-on-conflict (lib/wallConfigWriter.ts), and
-- it works there because wall edits are occasional and effectively single-user.
--
-- A canvas is the opposite: during a live desk crit a professor drags a sticky
-- while the student moves an image, seconds apart. Against one blob those are
-- two writes to the same row — constant 409s, or one silently clobbering the
-- other, precisely when the record matters most.
--
-- Per-node rows make edits to DIFFERENT objects genuinely conflict-free with no
-- coordination at all, keep realtime payloads to the object that moved rather
-- than the whole document, and let undo be per-user. Concurrent edits to the
-- SAME node resolve last-write-wins on updated_at, which is the right tradeoff
-- for direct manipulation: whoever is currently dragging a thing should win.
--
-- TWO CONSEQUENCES OF LWW THE CLIENT MUST HONOUR:
--   * Ink is ONE NODE PER STROKE. Accumulating points into a single node's
--     props loses whole strokes when two people draw at once — the schema
--     permits either shape, so this is a client contract, not a constraint.
--   * Concurrent typing into the same sticky/text body clobbers character for
--     character. Acceptable with an edit-lock or a presence indicator; not
--     acceptable to discover during a live crit.
--
--
-- WHY THERE ARE SELECT POLICIES HERE
--
-- Supabase Realtime evaluates SELECT policies AS THE SUBSCRIBING USER, and
-- silently drops rows the user can't select. RLS-enabled + no policies +
-- published therefore delivers ZERO events to everyone except the service role
-- — which is exactly the bug migration 030 was written to repair for
-- board_comments/board_traces after they shipped that way in 028.
--
-- So canvas_nodes gets the same SELECT-only set 030 established, pivoted
-- room_id -> rooms -> workspace. This does NOT weaken the service-role +
-- app-check pattern: writes stay API-enforced, and no INSERT/UPDATE/DELETE
-- policy is created here. `canvases` needs none — nothing subscribes to it.
--
-- RLS-RESOLUTION NOTE (subqueries run under the caller's RLS): the MEMBER
-- branch references workspace_members DIRECTLY and never JOINs workspaces —
-- members cannot read the workspaces row, so a join silently returns nothing.
-- The owner/public/org branches DO join workspaces, because those three
-- workspaces SELECT policies exist. This mirrors 030 exactly.
--
-- Idempotent: every CREATE POLICY is preceded by DROP POLICY IF EXISTS.

BEGIN;

-- ---------------------------------------------------------------------------
-- canvases — one infinite surface.
--
-- Scoped to a room so access checks reuse the existing owner / member / org /
-- public resolution rather than inventing a second permission surface. When
-- desk sessions land (phase 4) they attach via a nullable desk_session_id
-- added then; room_id stays the access anchor either way.
--
-- NOT published to supabase_realtime: renames are rare. Note the consequence —
-- a canvas CREATED mid-session won't appear for other users on its own. Use the
-- existing broadcast-ping pattern for that (see the "boards-dirty" ping in
-- app/studio/[id]/page.tsx), which guests need anyway since they receive no
-- postgres_changes at all.
-- ---------------------------------------------------------------------------
CREATE TABLE canvases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title         TEXT,
  created_by    TEXT NOT NULL,                    -- Supabase uid, TEXT like board_traces.author_id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX canvases_room_idx ON canvases(room_id);
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;   -- no policies: service-role only

-- ---------------------------------------------------------------------------
-- canvas_nodes — one row per object on a canvas.
--
-- `id` is TEXT and client-generated, like boards.id and board_traces.id, so a
-- newly drawn object can render and be addressed immediately without waiting
-- for a server round-trip to learn its identity.
--
-- Geometry is stored in CANVAS units, not screen pixels — the viewport applies
-- pan/zoom at render time. Screen-space coordinates would be meaningless to a
-- second viewer at a different zoom, the same reason board comments and trace
-- strokes store image fractions rather than pixels.
--
-- `props` carries everything type-specific and is deliberately schemaless: text
-- content and colour for a sticky, a storage URL for an image, the point list
-- for one ink stroke. New tools add a `type` and a props shape. Connector
-- endpoints are the exception — see from_node_id/to_node_id below.
--
-- Authorship mirrors board_comments as it stands AFTER migration 029: author_id
-- nullable + guest_token_id + author_name, and deliberately NO check tying the
-- two together. Guest critics have no auth.users row, so a NOT NULL account id
-- cannot represent them at all — and the check 028 originally shipped had to be
-- dropped in 029 because it made revoking a guest link fail. See the note on
-- the columns below before re-adding one.
-- ---------------------------------------------------------------------------
CREATE TABLE canvas_nodes (
  id             TEXT PRIMARY KEY,
  canvas_id      UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  -- Denormalised so the SELECT policies below can pivot to the workspace
  -- without a join, and so a DELETE event still carries it (REPLICA IDENTITY
  -- FULL). Subscribers should filter on canvas_id, not this — a room can hold
  -- many canvases and a client renders exactly one.
  --
  -- MUST equal the parent canvas's room_id. Nothing in the schema enforces
  -- that, and because the SELECT policies pivot on THIS column, a mismatched
  -- write is a visibility bug and not merely an integrity one — a node could
  -- become visible to the wrong workspace. Writes are service-role-only and go
  -- through one API route, which is what contains it; derive room_id from the
  -- canvas there rather than trusting a client-supplied value.
  room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  x              DOUBLE PRECISION NOT NULL DEFAULT 0,
  y              DOUBLE PRECISION NOT NULL DEFAULT 0,
  w              DOUBLE PRECISION NOT NULL DEFAULT 0,
  h              DOUBLE PRECISION NOT NULL DEFAULT 0,
  rotation       DOUBLE PRECISION NOT NULL DEFAULT 0,   -- radians, matching the 3D room
  -- Ties are expected and fine; the client must paint with a deterministic
  -- ORDER BY (z, created_at, id) or two viewers stack overlapping nodes
  -- differently. Deliberately NOT unique per canvas: that would 409 on
  -- concurrent inserts and make reordering a multi-row transaction.
  z              INTEGER NOT NULL DEFAULT 0,
  props          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Connector endpoints are real columns, not props, so deleting an endpoint
  -- cascades the connector away instead of orphaning it. props has no
  -- referential integrity and a dangling connector is permanent. The cascade
  -- also emits a DELETE event, which is what clients want anyway.
  from_node_id   TEXT REFERENCES canvas_nodes(id) ON DELETE CASCADE,
  to_node_id     TEXT REFERENCES canvas_nodes(id) ON DELETE CASCADE,
  author_id      TEXT,                             -- Supabase uid; NULL for guest critics
  guest_token_id UUID REFERENCES guest_tokens(id) ON DELETE SET NULL,
  author_name    TEXT NOT NULL,
  -- Last writer wins per NODE. An OPAQUE identity string, not necessarily an
  -- account uid: guest critics have no auth.users row, so for them this holds
  -- the guest token id. It exists for attribution and so a client can ignore
  -- the echo of its own optimistic write — both work on equality alone.
  updated_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NO author CHECK here, deliberately. 028 had one and migration 029 dropped
  -- it: with ON DELETE SET NULL, revoking a guest link NULLs guest_token_id on
  -- that guest's rows, leaving both identity columns NULL — the check then
  -- fails and aborts the parent DELETE, so deleting a guest link 500s once
  -- that guest has drawn anything. author_name is the real display anchor and
  -- is NOT NULL, so an orphaned guest row still renders. Insert-time identity
  -- is enforced in app code, which always sets exactly one of the two.
  -- The valid set lived only in a comment before. A typo'd type inserts
  -- cleanly and renders as nothing, forever; widening this is one line.
  CONSTRAINT canvas_nodes_type_chk
    CHECK (type IN ('sticky', 'text', 'image', 'ink', 'shape', 'frame', 'connector')),
  -- Bounded ranges, NOT `w >= 0` or self-equality. Postgres deliberately
  -- departs from IEEE for float ordering: NaN compares EQUAL to itself and
  -- GREATER than every non-NaN value, so `x = x` never fails and `w >= 0` is
  -- true for both NaN and Infinity. Only an upper bound rejects them, since
  -- `NaN < 1e7` and `Infinity < 1e7` are both false. 1e7 canvas units is far
  -- past any real drawing and well inside exact-integer double range.
  CONSTRAINT canvas_nodes_size_chk
    CHECK (w >= 0 AND w < 1e7 AND h >= 0 AND h < 1e7),
  CONSTRAINT canvas_nodes_position_chk
    CHECK (abs(x) < 1e7 AND abs(y) < 1e7 AND abs(rotation) < 1e7),
  -- Endpoints belong to connectors only. Without this a sticky could carry
  -- one, and deleting the referenced node would silently cascade the sticky
  -- away. (Constraining endpoints to reference only NON-connector nodes would
  -- need a composite FK against UNIQUE (id, type) plus a redundant type
  -- column — not worth it for the remaining 10%.)
  CONSTRAINT canvas_nodes_endpoints_chk
    CHECK ((from_node_id IS NULL AND to_node_id IS NULL) OR type = 'connector')
);
-- Ordered fetch of a whole canvas is the hot read; z is in the index so paint
-- order comes back sorted without a separate sort step.
CREATE INDEX canvas_nodes_canvas_z_idx ON canvas_nodes(canvas_id, z);
CREATE INDEX canvas_nodes_room_idx     ON canvas_nodes(room_id);
-- Postgres does not auto-index the REFERENCING side of a FK, so without these
-- every node DELETE sequentially scans canvas_nodes looking for connectors to
-- cascade. Same reason 028 indexed board_comments.parent_id.
CREATE INDEX canvas_nodes_from_idx     ON canvas_nodes(from_node_id) WHERE from_node_id IS NOT NULL;
CREATE INDEX canvas_nodes_to_idx       ON canvas_nodes(to_node_id)   WHERE to_node_id IS NOT NULL;
ALTER TABLE canvas_nodes ENABLE ROW LEVEL SECURITY;

-- REQUIRED: this table IS subscribed via postgres_changes (CLAUDE.md hard rule).
ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_nodes;
-- FULL so a filtered DELETE event still carries canvas_id/room_id — without it
-- subscribers receive only the primary key and cannot tell whether a deletion
-- belongs to the canvas they are showing.
ALTER TABLE public.canvas_nodes REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- updated_at maintenance.
--
-- Not optional here: updated_at IS the last-write-wins key. Without a trigger
-- it freezes at insert time unless every writer remembers to set it, and
-- server now() also beats client clocks — clock skew would otherwise be a
-- correctness bug rather than a cosmetic one.
--
-- update_updated_at_column() already exists (migration 014).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS canvases_updated_at ON canvases;
CREATE TRIGGER canvases_updated_at
  BEFORE UPDATE ON canvases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS canvas_nodes_updated_at ON canvas_nodes;
CREATE TRIGGER canvas_nodes_updated_at
  BEFORE UPDATE ON canvas_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- SELECT-only policies so realtime actually delivers. See the header.
-- Mirrors the board_traces set in migration 030 exactly.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view canvas_nodes in their own workspaces" ON canvas_nodes;
CREATE POLICY "Users can view canvas_nodes in their own workspaces"
ON canvas_nodes FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.owner_id = auth.uid()::text
  )
);

-- workspace_members DIRECTLY — never JOIN workspaces here. See header.
DROP POLICY IF EXISTS "Members can view canvas_nodes in member workspaces" ON canvas_nodes;
CREATE POLICY "Members can view canvas_nodes in member workspaces"
ON canvas_nodes FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    WHERE r.workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()::text
    )
  )
);

DROP POLICY IF EXISTS "Anyone can view canvas_nodes in public workspaces" ON canvas_nodes;
CREATE POLICY "Anyone can view canvas_nodes in public workspaces"
ON canvas_nodes FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.is_public = true AND w.published_at IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Org members can view canvas_nodes in org workspaces" ON canvas_nodes;
CREATE POLICY "Org members can view canvas_nodes in org workspaces"
ON canvas_nodes FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.organization_id IS NOT NULL
      AND w.organization_id = get_my_institution_id()
  )
);

COMMIT;
