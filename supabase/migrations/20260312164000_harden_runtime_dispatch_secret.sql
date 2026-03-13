create schema if not exists online_private;

drop function if exists online_private.get_supabase_anon_key();
create or replace function online_private.get_supabase_anon_key()
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
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
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
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

grant usage on schema online_private to anon, authenticated, service_role;
grant execute on function online_private.get_supabase_anon_key() to anon, authenticated, service_role;
grant execute on function online_private.get_runtime_dispatch_secret() to anon, authenticated, service_role;

drop function if exists online_dispatch_edge_runtime();
create or replace function online_dispatch_edge_runtime()
returns bigint
language plpgsql
as $dispatch$
declare
  v_request_id bigint;
  v_should_run boolean := false;
  v_anon_key text;
  v_dispatch_secret text;
begin
  if coalesce(online_request_role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    return null;
  end if;

  select
    exists(
      select 1
      from online_hands h
      join online_tables t on t.id = h.table_id
      where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
        and t.status <> 'closed'
    )
    or exists(select 1 from online_runtime_due_tables(1))
  into v_should_run;

  if not coalesce(v_should_run, false) then
    return null;
  end if;

  v_anon_key := online_private.get_supabase_anon_key();
  if coalesce(v_anon_key, '') = '' then
    raise exception 'supabase_anon_key_not_configured';
  end if;

  v_dispatch_secret := online_private.get_runtime_dispatch_secret();
  if coalesce(v_dispatch_secret, '') = '' then
    raise exception 'online_runtime_dispatch_secret_not_configured';
  end if;

  select net.http_post(
    url := 'https://xngwmtwrruvbrlxhekxp.supabase.co/functions/v1/online-runtime-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key,
      'x-online-runtime-secret', v_dispatch_secret
    ),
    body := jsonb_build_object(
      'limit', 48,
      'max_advance_per_hand', 4,
      'settle_note', 'edge_runtime_auto_showdown'
    )
  )
  into v_request_id;

  return v_request_id;
end;
$dispatch$;
