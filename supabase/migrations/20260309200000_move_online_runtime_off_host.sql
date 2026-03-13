alter table online_tables
  add column if not exists auto_deal_enabled boolean not null default true;

alter table online_tables
  add column if not exists showdown_delay_secs int not null default 5;

alter table online_tables
  add column if not exists decision_time_secs int not null default 25;

update online_tables
set
  auto_deal_enabled = coalesce(auto_deal_enabled, true),
  showdown_delay_secs = case
    when coalesce(showdown_delay_secs, 5) in (3, 5, 9) then coalesce(showdown_delay_secs, 5)
    else 5
  end,
  decision_time_secs = greatest(10, least(coalesce(decision_time_secs, 25), 120));

drop function if exists online_request_role();
create or replace function online_request_role()
returns text
language plpgsql
stable
as $role$
declare
  v_role text;
begin
  begin
    v_role := auth.role();
  exception when others then
    v_role := null;
  end;

  if coalesce(v_role, '') = '' then
    v_role := nullif(current_setting('request.jwt.claim.role', true), '');
  end if;

  if coalesce(v_role, '') = '' then
    begin
      v_role := nullif((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
    exception when others then
      v_role := null;
    end;
  end if;

  return v_role;
end;
$role$;

drop function if exists online_runtime_processable_hands(uuid, int);
create or replace function online_runtime_processable_hands(
  p_table_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid,
  table_id uuid,
  state text,
  action_seat int,
  last_action_at timestamptz,
  decision_time_secs int
)
language sql
stable
as $$
  select
    h.id,
    h.table_id,
    h.state,
    h.action_seat,
    h.last_action_at,
    greatest(coalesce(t.decision_time_secs, 25), 10)::int as decision_time_secs
  from online_hands h
  join online_tables t on t.id = h.table_id
  where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
    and (p_table_id is null or h.table_id = p_table_id)
    and t.status <> 'closed'
  order by h.last_action_at asc nulls last
  limit greatest(coalesce(p_limit, 50), 1);
$$;

drop function if exists online_runtime_due_tables(int);
create or replace function online_runtime_due_tables(
  p_limit int default 24
)
returns table (
  table_id uuid
)
language sql
stable
as $$
  with latest_hand as (
    select distinct on (h.table_id)
      h.table_id,
      h.state,
      h.ended_at
    from online_hands h
    order by h.table_id, h.hand_no desc
  )
  select t.id as table_id
  from online_tables t
  join latest_hand lh on lh.table_id = t.id
  where t.status <> 'closed'
    and coalesce(t.auto_deal_enabled, true)
    and lh.state in ('settled', 'canceled')
    and coalesce(lh.ended_at, now()) <= now() - make_interval(secs => greatest(coalesce(t.showdown_delay_secs, 5), 1))
    and not exists (
      select 1
      from online_hands active_hand
      where active_hand.table_id = t.id
        and active_hand.state not in ('settled', 'canceled')
    )
    and (
      select count(*)
      from online_table_seats s
      where s.table_id = t.id
        and s.group_player_id is not null
        and s.left_at is null
        and not s.is_sitting_out
        and coalesce(s.chip_stack, 0) > 0
    ) >= 2
  order by lh.ended_at asc nulls last
  limit greatest(coalesce(p_limit, 24), 1);
$$;

drop function if exists online_runtime_start_hand(uuid, text);
create or replace function online_runtime_start_hand(
  p_table_id uuid,
  p_note text default 'edge_runtime_auto_deal'
)
returns online_hands
language plpgsql
as $runtime$
declare
  v_actor_group_player_id uuid;
  v_actor_seat_token text;
  v_hand online_hands%rowtype;
begin
  if online_request_role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;

  if online_active_human_host_group_player(p_table_id) is null then
    perform online_prune_bot_seats(p_table_id);
    update online_tables
    set created_by_group_player_id = online_first_active_human_group_player(p_table_id)
    where id = p_table_id
      and online_active_human_host_group_player(p_table_id) is null;
  end if;

  v_actor_group_player_id := coalesce(
    online_active_human_host_group_player(p_table_id),
    online_first_active_human_group_player(p_table_id)
  );

  if v_actor_group_player_id is null then
    raise exception 'runtime_no_active_human_host';
  end if;

  select s.seat_token
  into v_actor_seat_token
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = v_actor_group_player_id
    and s.left_at is null
  order by s.seat_no
  limit 1;

  if coalesce(v_actor_seat_token, '') = '' then
    raise exception 'runtime_host_seat_token_missing';
  end if;

  v_hand := online_start_hand(
    p_table_id,
    v_actor_group_player_id,
    v_actor_seat_token
  );

  perform online_append_hand_event(
    v_hand.id,
    p_table_id,
    'hand_auto_started',
    v_actor_group_player_id,
    jsonb_build_object('reason', coalesce(nullif(trim(p_note), ''), 'edge_runtime_auto_deal'))
  );

  return v_hand;
end;
$runtime$;

drop function if exists online_update_table_settings(uuid, uuid, text, numeric, numeric, boolean, int, int);
create or replace function online_update_table_settings(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_small_blind numeric default null,
  p_big_blind numeric default null,
  p_auto_deal_enabled boolean default null,
  p_showdown_delay_secs int default null,
  p_decision_time_secs int default null
)
returns online_tables
language plpgsql
as $settings$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_small_blind numeric;
  v_big_blind numeric;
  v_auto_deal_enabled boolean;
  v_showdown_delay_secs int;
  v_decision_time_secs int;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select *
  into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_required_to_update_table_settings';
  end if;

  select *
  into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
  order by seat_no
  limit 1;

  if not found then
    raise exception 'host_not_seated';
  end if;

  if v_actor_seat.seat_token is distinct from p_actor_seat_token then
    raise exception 'host_seat_token_invalid';
  end if;

  v_small_blind := greatest(coalesce(p_small_blind, v_table.small_blind), 0);
  v_big_blind := greatest(coalesce(p_big_blind, v_table.big_blind), 0);
  v_auto_deal_enabled := coalesce(p_auto_deal_enabled, v_table.auto_deal_enabled);
  v_showdown_delay_secs := coalesce(p_showdown_delay_secs, v_table.showdown_delay_secs);
  v_decision_time_secs := coalesce(p_decision_time_secs, v_table.decision_time_secs);

  if v_small_blind <= 0 or v_big_blind <= 0 then
    raise exception 'invalid_blinds';
  end if;

  if v_big_blind < v_small_blind then
    raise exception 'small_blind_cannot_exceed_big_blind';
  end if;

  if v_showdown_delay_secs not in (3, 5, 9) then
    raise exception 'showdown_delay_out_of_range';
  end if;

  if v_decision_time_secs < 10 or v_decision_time_secs > 120 then
    raise exception 'decision_time_out_of_range';
  end if;

  update online_tables
  set
    small_blind = v_small_blind,
    big_blind = v_big_blind,
    auto_deal_enabled = v_auto_deal_enabled,
    showdown_delay_secs = v_showdown_delay_secs,
    decision_time_secs = v_decision_time_secs
  where id = p_table_id
  returning * into v_table;

  return v_table;
end;
$settings$;

create extension if not exists pg_net;
create extension if not exists pg_cron;

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

  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'SUPABASE_ANON_KEY'
      order by created_at desc
      limit 1
    $vault$
    into v_anon_key;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_anon_key := null;
  end;
  if coalesce(v_anon_key, '') = '' then
    v_anon_key := nullif(current_setting('app.settings.supabase_anon_key', true), '');
  end if;
  if coalesce(v_anon_key, '') = '' then
    raise exception 'supabase_anon_key_not_configured';
  end if;

  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'ONLINE_RUNTIME_DISPATCH_SECRET'
      order by created_at desc
      limit 1
    $vault$
    into v_dispatch_secret;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_dispatch_secret := null;
  end;
  if coalesce(v_dispatch_secret, '') = '' then
    v_dispatch_secret := nullif(current_setting('app.settings.online_runtime_dispatch_secret', true), '');
  end if;
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

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'online-runtime-dispatch'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'online-runtime-dispatch',
    '2 seconds',
    $job$select online_dispatch_edge_runtime();$job$
  );
end
$cron$;
