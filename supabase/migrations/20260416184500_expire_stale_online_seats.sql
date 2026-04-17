alter table online_table_seats
  add column if not exists last_seen_at timestamptz not null default now();

update online_table_seats
set last_seen_at = case
  when left_at is null then now()
  else coalesce(left_at, joined_at, now())
end;

create index if not exists idx_online_table_seats_active_last_seen
  on online_table_seats(last_seen_at)
  where left_at is null and group_player_id is not null;

drop function if exists online_claim_table_seat(uuid, uuid);
create or replace function online_claim_table_seat(
  p_table_id uuid,
  p_group_player_id uuid
)
returns online_table_seats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table online_tables%rowtype;
  v_seat online_table_seats%rowtype;
begin
  select * into v_table from online_tables where id = p_table_id for update;
  if not found then
    raise exception 'online_table_not_found';
  end if;
  if v_table.status = 'closed' then
    raise exception 'online_table_closed';
  end if;

  perform 1
  from group_players
  where id = p_group_player_id
    and group_id = v_table.group_id
    and archived_at is null;
  if not found then
    raise exception 'player_not_eligible_for_group';
  end if;

  update online_table_seats
  set
    seat_token = encode(gen_random_bytes(16), 'hex'),
    joined_at = now(),
    last_seen_at = now()
  where id in (
    select id
    from online_table_seats
    where table_id = p_table_id
      and group_player_id = p_group_player_id
      and left_at is null
    for update
    limit 1
  )
  returning * into v_seat;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  return v_seat;
end;
$$;

drop function if exists online_join_table(uuid, uuid, int, numeric);
drop function if exists online_join_table(uuid, uuid, int, numeric, text);
drop function if exists online_join_table(uuid, uuid, int, numeric, text, boolean);
drop function if exists online_join_table(uuid, uuid, int, numeric, text, boolean, text);
create or replace function online_join_table(
  p_table_id uuid,
  p_group_player_id uuid,
  p_preferred_seat int default null,
  p_chip_stack numeric default null,
  p_seat_token text default null,
  p_is_bot boolean default false,
  p_bot_personality text default null
)
returns online_table_seats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table online_tables%rowtype;
  v_existing online_table_seats%rowtype;
  v_joined online_table_seats%rowtype;
  v_stack numeric;
begin
  if not coalesce(p_is_bot, false) then
    perform online_check_join_rate_limit(p_table_id, p_group_player_id);
  end if;

  select * into v_table from online_tables where id = p_table_id for update;
  if not found then
    raise exception 'online_table_not_found';
  end if;
  if v_table.status = 'closed' then
    raise exception 'online_table_closed';
  end if;

  perform 1
  from group_players
  where id = p_group_player_id
    and group_id = v_table.group_id
    and archived_at is null;
  if not found then
    raise exception 'player_not_eligible_for_group';
  end if;

  v_stack := coalesce(p_chip_stack, v_table.starting_stack, 200);

  insert into online_table_seats(table_id, seat_no, chip_stack)
  select p_table_id, gs, 0
  from generate_series(1, v_table.max_seats) as gs
  on conflict (table_id, seat_no) do nothing;

  select * into v_existing
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
  limit 1;
  if found then
    if coalesce(nullif(trim(p_seat_token), ''), '') <> '' and p_seat_token = v_existing.seat_token then
      return v_existing;
    end if;
    raise exception 'player_already_seated_claim_required';
  end if;

  if p_preferred_seat is not null then
    if p_preferred_seat < 1 or p_preferred_seat > v_table.max_seats then
      raise exception 'preferred_seat_out_of_range';
    end if;

    update online_table_seats
    set
      group_player_id = p_group_player_id,
      chip_stack = greatest(v_stack, 0),
      is_bot = coalesce(p_is_bot, false),
      bot_personality = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_personality), '') else null end,
      bot_rebuy_count = case when coalesce(p_is_bot, false) then 0 else 0 end,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
      joined_at = now(),
      last_seen_at = now(),
      left_at = null
    where id in (
      select id
      from online_table_seats
      where table_id = p_table_id
        and seat_no = p_preferred_seat
        and (group_player_id is null or left_at is not null)
      for update skip locked
      limit 1
    )
    returning * into v_joined;
  else
    update online_table_seats
    set
      group_player_id = p_group_player_id,
      chip_stack = greatest(v_stack, 0),
      is_bot = coalesce(p_is_bot, false),
      bot_personality = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_personality), '') else null end,
      bot_rebuy_count = case when coalesce(p_is_bot, false) then 0 else 0 end,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
      joined_at = now(),
      last_seen_at = now(),
      left_at = null
    where id in (
      select id
      from online_table_seats
      where table_id = p_table_id
        and (group_player_id is null or left_at is not null)
      order by seat_no
      for update skip locked
      limit 1
    )
    returning * into v_joined;
  end if;

  if not found then
    raise exception 'online_table_full_or_seat_taken';
  end if;

  if v_table.status = 'waiting' then
    update online_tables set status = 'active' where id = p_table_id;
  end if;

  if not coalesce(p_is_bot, false)
     and online_active_human_host_group_player(p_table_id) is null
  then
    perform online_prune_bot_seats(p_table_id);
    update online_tables
    set created_by_group_player_id = online_first_active_human_group_player(p_table_id)
    where id = p_table_id
      and online_active_human_host_group_player(p_table_id) is null;
  end if;

  return v_joined;
end;
$$;

drop function if exists online_touch_seat_presence(uuid, uuid, text);
create or replace function online_touch_seat_presence(
  p_table_id uuid,
  p_group_player_id uuid,
  p_seat_token text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seen_at timestamptz;
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  update online_table_seats
  set last_seen_at = now()
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
    and seat_token = p_seat_token
  returning last_seen_at into v_seen_at;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  return v_seen_at;
end;
$$;

drop function if exists online_refresh_seat_presence(uuid, uuid, text, int);
create or replace function online_refresh_seat_presence(
  p_table_id uuid,
  p_group_player_id uuid,
  p_seat_token text,
  p_min_interval_secs int default 60
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_refreshed boolean := false;
begin
  if p_group_player_id is null
     or coalesce(nullif(trim(p_seat_token), ''), '') = ''
  then
    return false;
  end if;

  update online_table_seats
  set last_seen_at = now()
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
    and seat_token = p_seat_token
    and coalesce(last_seen_at, joined_at, now() - interval '1 day')
      <= now() - make_interval(secs => greatest(coalesce(p_min_interval_secs, 60), 15))
  returning true into v_refreshed;

  return coalesce(v_refreshed, false);
end;
$$;

drop function if exists online_get_table_state_viewer(uuid, uuid, text, bigint);
create or replace function online_get_table_state_viewer(
  p_table_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
  v_chat_messages jsonb := '[]'::jsonb;
  v_voice_state jsonb := '{}'::jsonb;
begin
  perform online_refresh_seat_presence(
    p_table_id,
    p_viewer_group_player_id,
    p_viewer_seat_token,
    60
  );

  select to_jsonb(t) into v_table
  from online_tables t
  where t.id = p_table_id;

  if v_table is null then
    raise exception 'online_table_not_found';
  end if;

  select coalesce(
    jsonb_agg(
      ((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name))
      order by s.seat_no
    ),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id;

  select h.id
  into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state_viewer(
      v_hand_id,
      p_viewer_group_player_id,
      p_viewer_seat_token,
      p_since_seq
    );
  end if;

  v_chat_messages := online_get_table_chat_messages(
    p_table_id,
    p_viewer_group_player_id,
    p_viewer_seat_token,
    20
  );

  select coalesce(
    jsonb_build_object(
      'speaker_player_id', vs.active_speaker_group_player_id,
      'speaker_name', gp.name,
      'floor_expires_at', vs.floor_expires_at,
      'is_active', (vs.active_speaker_group_player_id is not null and coalesce(vs.floor_expires_at, now()) > now()),
      'call_status', coalesce(vs.call_status, 'idle'),
      'call_started_by_player_id', vs.call_started_by_group_player_id,
      'call_started_by_name', host_gp.name,
      'call_started_at', vs.call_started_at
    ),
    '{}'::jsonb
  )
  into v_voice_state
  from online_table_voice_state vs
  left join group_players gp on gp.id = vs.active_speaker_group_player_id
  left join group_players host_gp on host_gp.id = vs.call_started_by_group_player_id
  where vs.table_id = p_table_id;

  return jsonb_build_object(
    'table', v_table,
    'seats', coalesce(v_seats, '[]'::jsonb),
    'latest_hand', coalesce(v_hand_state, '{}'::jsonb),
    'chat_messages', coalesce(v_chat_messages, '[]'::jsonb),
    'voice_state', coalesce(v_voice_state, '{}'::jsonb)
  );
end;
$$;

drop function if exists online_get_table_game_state_viewer(uuid, uuid, text, bigint);
create or replace function online_get_table_game_state_viewer(
  p_table_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
begin
  perform online_refresh_seat_presence(
    p_table_id,
    p_viewer_group_player_id,
    p_viewer_seat_token,
    60
  );

  select to_jsonb(t) into v_table
  from online_tables t
  where t.id = p_table_id;

  if v_table is null then
    raise exception 'online_table_not_found';
  end if;

  select coalesce(
    jsonb_agg(
      ((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name))
      order by s.seat_no
    ),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id;

  select h.id
  into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state_viewer(
      v_hand_id,
      p_viewer_group_player_id,
      p_viewer_seat_token,
      p_since_seq
    );
  end if;

  return jsonb_build_object(
    'table', v_table,
    'seats', coalesce(v_seats, '[]'::jsonb),
    'latest_hand', coalesce(v_hand_state, '{}'::jsonb)
  );
end;
$$;

drop function if exists online_runtime_expire_stale_human_seats(uuid, int, int);
create or replace function online_runtime_expire_stale_human_seats(
  p_table_id uuid default null,
  p_stale_after_secs int default 300,
  p_limit int default 32
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(online_request_role(), '');
  v_expired_count int := 0;
  v_closed_count int := 0;
  v_bot_pruned_count int := 0;
  v_stale_cutoff timestamptz := now() - make_interval(secs => greatest(coalesce(p_stale_after_secs, 300), 60));
  v_seat record;
  v_table record;
  v_removed_bots int;
begin
  if v_role <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'service_role_required';
  end if;

  for v_seat in
    select
      s.table_id,
      s.group_player_id,
      s.seat_token
    from online_table_seats s
    join online_tables t on t.id = s.table_id
    left join group_players gp on gp.id = s.group_player_id
    where s.group_player_id is not null
      and s.left_at is null
      and not (coalesce(s.is_bot, false) or coalesce(gp.name, '') ilike 'Bot %')
      and coalesce(s.last_seen_at, s.joined_at, t.updated_at, t.created_at) <= v_stale_cutoff
      and (p_table_id is null or s.table_id = p_table_id)
      and t.status <> 'closed'
    order by coalesce(s.last_seen_at, s.joined_at, t.updated_at, t.created_at) asc, s.joined_at asc, s.seat_no asc
    limit greatest(coalesce(p_limit, 32), 1)
  loop
    begin
      perform online_leave_table(
        v_seat.table_id,
        v_seat.group_player_id,
        v_seat.seat_token
      );
      v_expired_count := v_expired_count + 1;
    exception
      when others then
        null;
    end;
  end loop;

  for v_table in
    select t.id
    from online_tables t
    where (p_table_id is null or t.id = p_table_id)
      and t.status in ('waiting', 'active', 'paused')
      and not exists (
        select 1
        from online_table_seats s
        left join group_players gp on gp.id = s.group_player_id
        where s.table_id = t.id
          and s.group_player_id is not null
          and s.left_at is null
          and not (coalesce(s.is_bot, false) or coalesce(gp.name, '') ilike 'Bot %')
      )
      and exists (
        select 1
        from online_table_seats s
        where s.table_id = t.id
          and s.group_player_id is not null
          and s.left_at is null
      )
  loop
    v_removed_bots := online_prune_bot_seats(v_table.id);
    v_bot_pruned_count := v_bot_pruned_count + coalesce(v_removed_bots, 0);

    update online_hands
    set state = 'canceled',
        ended_at = coalesce(ended_at, now()),
        action_seat = null
    where table_id = v_table.id
      and state not in ('settled', 'canceled');

    update online_tables
    set status = 'closed',
        created_by_group_player_id = null
    where id = v_table.id
      and status <> 'closed';

    if found then
      v_closed_count := v_closed_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'expired_human_seats', v_expired_count,
    'pruned_bot_seats', v_bot_pruned_count,
    'closed_tables', v_closed_count,
    'stale_after_secs', greatest(coalesce(p_stale_after_secs, 300), 60)
  );
end;
$$;

grant execute on function online_touch_seat_presence(uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function online_runtime_expire_stale_human_seats(uuid, int, int) to service_role;
