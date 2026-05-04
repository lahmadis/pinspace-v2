-- Phase 4.2.5a: Add audit columns to org_requests
-- Tracks when each request was decided and which admin made the decision.
-- Both columns nullable: existing pre-audit rows stay NULL, future rows get populated.

begin;

alter table org_requests
  add column decided_at timestamptz,
  add column decided_by uuid references auth.users(id);

drop function if exists public.approve_org_request_as_new_org(uuid, text, text, text, text);
drop function if exists public.approve_org_request_as_existing(uuid, uuid);

create function public.approve_org_request_as_new_org(
  p_request_id uuid,
  p_name text,
  p_slug text,
  p_type text,
  p_network_label text,
  p_decided_by uuid
)
returns org_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_domain  text;
  v_org     organizations;
  v_request org_requests;
begin
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

  insert into organizations (name, slug, type, network_label)
  values (
    trim(p_name),
    lower(regexp_replace(trim(p_slug), '[^a-z0-9-]', '', 'g')),
    p_type,
    nullif(trim(coalesce(p_network_label, '')), '')
  )
  returning * into v_org;

  insert into org_domains (org_id, domain)
  values (v_org.id, v_domain);

  update org_requests
  set status = 'approved',
      decided_at = now(),
      decided_by = p_decided_by
  where domain = v_domain
    and status = 'pending';

  select * into v_request
  from org_requests
  where id = p_request_id;
  return v_request;
end;
$function$;

create function public.approve_org_request_as_existing(
  p_request_id uuid,
  p_existing_org_id uuid,
  p_decided_by uuid
)
returns org_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_domain     text;
  v_request    org_requests;
  v_org_exists boolean;
begin
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

  select exists(
    select 1 from organizations where id = p_existing_org_id
  ) into v_org_exists;
  if not v_org_exists then
    raise exception 'organization not found';
  end if;

  insert into org_domains (org_id, domain)
  values (p_existing_org_id, v_domain);

  update org_requests
  set status = 'approved',
      decided_at = now(),
      decided_by = p_decided_by
  where domain = v_domain
    and status = 'pending';

  select * into v_request
  from org_requests
  where id = p_request_id;
  return v_request;
end;
$function$;

commit;
