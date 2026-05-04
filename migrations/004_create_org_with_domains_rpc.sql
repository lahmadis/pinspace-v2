-- Phase 4.1, Migration 4: Atomic org creation RPC
-- Run in Supabase SQL Editor after 003_create_org_requests.sql has succeeded.
--
-- What this does:
--   Creates create_organization_with_domains(), a security-definer function that
--   inserts one row into organizations and seeds org_domains in a single transaction.
--   Only the service-role key can call it (anon/authenticated are revoked).

create or replace function create_organization_with_domains(
  p_name          text,
  p_slug          text,
  p_type          text,
  p_network_label text,
  p_domains       text[]
)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    organizations;
  v_domain text;
begin
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

  if p_domains is not null then
    foreach v_domain in array p_domains loop
      v_domain := lower(trim(v_domain));
      if v_domain <> '' then
        insert into org_domains (org_id, domain)
        values (v_org.id, v_domain);
      end if;
    end loop;
  end if;

  return v_org;
end;
$$;

revoke execute on function create_organization_with_domains(text, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function create_organization_with_domains(text, text, text, text, text[])
  to service_role;
