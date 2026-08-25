-- Migration 036: align the board reorder RPC with boards.id.
--
-- boards.id is TEXT and upload-created identifiers look like
-- `board-<timestamp>-<suffix>`. Migration 035 accidentally declared p_ids as
-- uuid[], so valid board IDs could not reach the UPDATE. Replace that overload
-- with a text[] function while preserving the room containment guard and the
-- service-role-only execution boundary.

begin;

drop function if exists public.reorder_room_boards(uuid, uuid[]);

create or replace function public.reorder_room_boards(p_room_id uuid, p_ids text[])
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

revoke all on function public.reorder_room_boards(uuid, text[]) from public;
revoke all on function public.reorder_room_boards(uuid, text[]) from anon, authenticated;
grant execute on function public.reorder_room_boards(uuid, text[]) to service_role;

commit;
