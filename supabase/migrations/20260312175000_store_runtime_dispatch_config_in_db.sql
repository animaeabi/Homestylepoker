create schema if not exists online_private;

create table if not exists online_private.runtime_dispatch_config (
  singleton boolean primary key default true check (singleton),
  supabase_anon_key text,
  dispatch_secret text,
  updated_at timestamptz not null default now()
);

revoke all on online_private.runtime_dispatch_config from public;
revoke all on online_private.runtime_dispatch_config from anon;
revoke all on online_private.runtime_dispatch_config from authenticated;

drop function if exists online_private.get_supabase_anon_key();
create or replace function online_private.get_supabase_anon_key()
returns text
language plpgsql
security definer
stable
set search_path = public, online_private, pg_temp
as $$
declare
  v_key text;
begin
  begin
    select rdc.supabase_anon_key
    into v_key
    from online_private.runtime_dispatch_config rdc
    where rdc.singleton = true;
  exception
    when undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') <> '' then
    return v_key;
  end if;

  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'SUPABASE_ANON_KEY'
      order by created_at desc
      limit 1
    $vault$
    into v_key;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') = '' then
    v_key := nullif(current_setting('app.settings.supabase_anon_key', true), '');
  end if;

  return v_key;
end;
$$;

drop function if exists online_private.get_runtime_dispatch_secret();
create or replace function online_private.get_runtime_dispatch_secret()
returns text
language plpgsql
security definer
stable
set search_path = public, online_private, pg_temp
as $$
declare
  v_key text;
begin
  begin
    select rdc.dispatch_secret
    into v_key
    from online_private.runtime_dispatch_config rdc
    where rdc.singleton = true;
  exception
    when undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') <> '' then
    return v_key;
  end if;

  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'ONLINE_RUNTIME_DISPATCH_SECRET'
      order by created_at desc
      limit 1
    $vault$
    into v_key;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') = '' then
    v_key := nullif(current_setting('app.settings.online_runtime_dispatch_secret', true), '');
  end if;

  return v_key;
end;
$$;

drop function if exists online_set_runtime_dispatch_config(text, text);
create or replace function online_set_runtime_dispatch_config(
  p_supabase_anon_key text,
  p_dispatch_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_role text := coalesce(online_request_role(), '');
begin
  if v_role <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'service_role_required';
  end if;

  insert into online_private.runtime_dispatch_config as cfg (
    singleton,
    supabase_anon_key,
    dispatch_secret,
    updated_at
  )
  values (
    true,
    nullif(trim(coalesce(p_supabase_anon_key, '')), ''),
    nullif(trim(coalesce(p_dispatch_secret, '')), ''),
    now()
  )
  on conflict (singleton) do update
    set supabase_anon_key = excluded.supabase_anon_key,
        dispatch_secret = excluded.dispatch_secret,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function online_set_runtime_dispatch_config(text, text) to service_role;
