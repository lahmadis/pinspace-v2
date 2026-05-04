-- Phase 4.2, Migration 5: Org request approval RPCs
-- Run in Supabase SQL Editor after 004_create_org_with_domains_rpc.sql has succeeded.
--
-- What this does:
--   Two security-definer functions, both callable only by service_role:
--
--   approve_org_request_as_new_org  — creates an org, registers the domain,
--     and marks all pending requests for that domain as approved atomically.
--
--   approve_org_request_as_existing — attaches the domain to an existing org
--     and marks all pending requests for that domain as approved atomically.
--
-- Design notes:
--   Rejected rows are preserved by design — they accumulate as an audit log
--   of declined requests and are never deleted. A future history view can
--   surface them when needed. Only status is updated, not the row itself.
--
--   Both functions use SELECT ... FOR UPDATE to lock the request row inside
--   the transaction, preventing two concurrent approvals of the same request
--   from both succeeding.

-- ─────────────────────────────────────────────────────────────────────────────
-- Function 1: approve_org_request_as_new_org
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function approve_org_request_as_new_org(
  p_request_id    uuid,
  p_name          text,
  p_slug          text,
  p_type          text,   -- 'university' | 'firm'
  p_network_label text
)
returns org_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain  text;
  v_org     organizations;
  v_request org_requests;
begin
  -- Lock the row. If two sessions race to approve the same request, the second
  -- will wait here, then find status != 'pending' and raise 'already_processed'.
  select * into v_request
  from org_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'already_processed';
  end if;

  if v_request.status != 'pending' then
    raise exception 'already_processed';
  end if;

  v_domain := v_request.domain;

  if p_name is null or trim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_slug is null or trim(p_slug) = '' then
    raise exception 'slug is required';
  end if;
  if p_type not in ('university', 'firm') then
    raise exception 'type must be university or firm';
  end if;

  -- Insert the new org.
  insert into organizations (name, slug, type, network_label)
  values (
    trim(p_name),
    lower(regexp_replace(trim(p_slug), '[^a-z0-9-]', '', 'g')),
    p_type,
    nullif(trim(coalesce(p_network_label, '')), '')
  )
  returning * into v_org;

  -- Register the domain. A 23505 unique violation here means the domain was
  -- added to another org between request submission and approval — the whole
  -- transaction rolls back and the request stays pending.
  insert into org_domains (org_id, domain)
  values (v_org.id, v_domain);

  -- Approve ALL pending requests for this domain, not just p_request_id.
  -- Multiple users may have submitted requests from the same domain; once the
  -- domain is registered they are all resolved. This is intentional batch
  -- resolution — not a bug.
  update org_requests
  set status = 'approved'
  where domain = v_domain
    and status = 'pending';

  -- Return the primary request row (now approved).
  select * into v_request
  from org_requests
  where id = p_request_id;

  return v_request;
end;
$$;

revoke execute on function approve_org_request_as_new_org(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function approve_org_request_as_new_org(uuid, text, text, text, text)
  to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Function 2: approve_org_request_as_existing
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function approve_org_request_as_existing(
  p_request_id      uuid,
  p_existing_org_id uuid
)
returns org_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain     text;
  v_request    org_requests;
  v_org_exists boolean;
begin
  -- Lock the row for the same idempotency reason as above.
  select * into v_request
  from org_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'already_processed';
  end if;

  if v_request.status != 'pending' then
    raise exception 'already_processed';
  end if;

  v_domain := v_request.domain;

  -- Verify the target org exists before attempting the domain insert.
  select exists(
    select 1 from organizations where id = p_existing_org_id
  ) into v_org_exists;

  if not v_org_exists then
    raise exception 'organization not found';
  end if;

  -- Attach the domain. Same 23505 handling as the new-org variant.
  insert into org_domains (org_id, domain)
  values (p_existing_org_id, v_domain);

  -- Batch-resolve all pending requests for this domain (same rationale as above).
  update org_requests
  set status = 'approved'
  where domain = v_domain
    and status = 'pending';

  select * into v_request
  from org_requests
  where id = p_request_id;

  return v_request;
end;
$$;

revoke execute on function approve_org_request_as_existing(uuid, uuid)
  from public, anon, authenticated;
grant execute on function approve_org_request_as_existing(uuid, uuid)
  to service_role;
