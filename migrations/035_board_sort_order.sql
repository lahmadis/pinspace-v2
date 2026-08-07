-- 035_board_sort_order.sql
-- Per-room slideshow order for the lightbox (Phase 2).
--
-- IDEMPOTENT BY CONSTRUCTION. The column, the index and the backfill were
-- already applied by hand in production before this file existed, so every
-- statement here must be a safe no-op against that database. Re-running the
-- whole file must never renumber a room that has already been ordered.
--
-- Scope note: sort_order drives ONLY the lightbox prev/next sequence and its
-- counter (lib/boardOrder.ts). Board placement in the 3D room stays entirely
-- position-derived — WallSystem selects by position_wall_index and computes
-- coordinates from position_x/position_y/position_side. Nothing here touches
-- placement, and no GET ORDER BY changed: the APIs still return uploaded_at
-- DESC and the client re-sorts for the lightbox only.

-- 1. Column -----------------------------------------------------------------
alter table public.boards add column if not exists sort_order integer;

-- 2. Index ------------------------------------------------------------------
-- (room_id, sort_order) is the exact shape of the reorder read below.
create index if not exists boards_room_sort_idx on public.boards (room_id, sort_order);

-- 3. Backfill ---------------------------------------------------------------
-- Seeds each room 1..N in upload order. `and b.sort_order is null` is what
-- makes this idempotent: rows already numbered (by the production hand-apply,
-- by the trigger below, or by a reorder) are left alone, so a re-run cannot
-- clobber a deliberate ordering.
with ranked as (
  select id, row_number() over (partition by room_id order by uploaded_at asc, id asc) as rn
  from public.boards
  where room_id is not null and upload_status <> 'pending'
)
update public.boards b set sort_order = ranked.rn
from ranked where b.id = ranked.id and b.sort_order is null;

-- 4. Default for new rows ---------------------------------------------------
-- Appends every new board to the end of its room's slideshow. Doing this in a
-- trigger rather than in app code covers uploads, clipboard pastes and
-- duplicates at once, without touching any of those insert paths.
--
-- SECURITY DEFINER so the max() below sees every row in the room regardless of
-- the inserter's RLS visibility — a filtered max() would hand out a duplicate
-- number. There is no injection surface: the body only reads an aggregate and
-- assigns to NEW.
--
-- Two concurrent inserts into the same room can still read the same max and
-- land on the same sort_order. That is deliberate — the read side breaks ties
-- on uploaded_at then id (lib/boardOrder.ts, compareBoardOrder), so the order
-- stays deterministic, and the next reorder renumbers the room cleanly. Not
-- worth a table lock on the upload path.
create or replace function public.boards_set_default_sort_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.sort_order is null and new.room_id is not null then
    select coalesce(max(sort_order), 0) + 1
      into new.sort_order
      from public.boards
     where room_id = new.room_id;
  end if;
  return new;
end;
$$;

drop trigger if exists boards_set_default_sort_order_trg on public.boards;
create trigger boards_set_default_sort_order_trg
  before insert on public.boards
  for each row execute function public.boards_set_default_sort_order();

-- 5. Reorder helper ---------------------------------------------------------
-- Renumbers a room to the supplied id order in ONE statement: unnest the id
-- array WITH ORDINALITY and join it to boards on id. The API route computes the
-- new ordering and calls this once — never one UPDATE per board.
--
-- `and b.room_id = p_room_id` is a hard containment guard: even if a caller
-- passes ids from another room, this can only ever renumber rows already in the
-- target room.
--
-- SECURITY DEFINER, so EXECUTE is revoked from anon/authenticated and granted
-- only to service_role. Without that revoke, PostgREST would expose an
-- unauthenticated way to scramble any room's ordering. The API route
-- (app/api/boards/reorder/route.ts) does the owner/superadmin check in app code
-- before calling this — no new RLS policies.
create or replace function public.reorder_room_boards(p_room_id uuid, p_ids uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.boards b
     set sort_order = v.rn
    from (
      select t.id, t.ord::int as rn
      from unnest(p_ids) with ordinality as t(id, ord)
    ) v
   where b.id = v.id
     and b.room_id = p_room_id;
$$;

revoke all on function public.reorder_room_boards(uuid, uuid[]) from public;
revoke all on function public.reorder_room_boards(uuid, uuid[]) from anon, authenticated;
grant execute on function public.reorder_room_boards(uuid, uuid[]) to service_role;
