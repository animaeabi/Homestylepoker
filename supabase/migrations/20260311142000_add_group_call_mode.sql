alter table online_table_voice_state
  add column if not exists call_status text;
alter table online_table_voice_state
  add column if not exists call_started_by_group_player_id uuid references group_players(id) on delete set null;
alter table online_table_voice_state
  add column if not exists call_started_at timestamptz;

update online_table_voice_state
set call_status = 'idle'
where call_status is null or btrim(call_status) = '';

alter table online_table_voice_state
  alter column call_status set default 'idle';
alter table online_table_voice_state
  alter column call_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'online_table_voice_state_call_status_check'
  ) then
    alter table online_table_voice_state
      add constraint online_table_voice_state_call_status_check
      check (call_status in ('idle','ringing','active'));
  end if;
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
as $$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
  v_chat_messages jsonb := '[]'::jsonb;
  v_voice_state jsonb := '{}'::jsonb;
begin
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
    40
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

drop function if exists online_start_voice_call(uuid, uuid, text);
create or replace function online_start_voice_call(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_voice online_table_voice_state%rowtype;
  v_host_group_player_id uuid;
  v_actor_name text;
  v_now timestamptz := now();
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  select t.created_by_group_player_id
  into v_host_group_player_id
  from online_tables t
  where t.id = p_table_id;

  if v_host_group_player_id is null then
    raise exception 'online_table_not_found';
  end if;

  if v_host_group_player_id <> p_actor_group_player_id then
    raise exception 'host_only_voice_call_control';
  end if;

  insert into online_table_voice_state (
    table_id,
    call_status,
    call_started_by_group_player_id,
    call_started_at,
    active_speaker_group_player_id,
    floor_expires_at,
    updated_at
  )
  values (
    p_table_id,
    'ringing',
    p_actor_group_player_id,
    v_now,
    null,
    null,
    v_now
  )
  on conflict (table_id) do update
    set
      call_status = 'ringing',
      call_started_by_group_player_id = excluded.call_started_by_group_player_id,
      call_started_at = excluded.call_started_at,
      active_speaker_group_player_id = null,
      floor_expires_at = null,
      updated_at = v_now
  returning * into v_voice;

  select gp.name into v_actor_name
  from group_players gp
  where gp.id = p_actor_group_player_id;

  return jsonb_build_object(
    'ok', true,
    'call_status', v_voice.call_status,
    'call_started_by_player_id', v_voice.call_started_by_group_player_id,
    'call_started_by_name', coalesce(v_actor_name, 'Host'),
    'call_started_at', v_voice.call_started_at
  );
end;
$$;

drop function if exists online_end_voice_call(uuid, uuid, text);
create or replace function online_end_voice_call(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_voice online_table_voice_state%rowtype;
  v_host_group_player_id uuid;
  v_now timestamptz := now();
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  select t.created_by_group_player_id
  into v_host_group_player_id
  from online_tables t
  where t.id = p_table_id;

  if v_host_group_player_id is null then
    raise exception 'online_table_not_found';
  end if;

  if v_host_group_player_id <> p_actor_group_player_id then
    raise exception 'host_only_voice_call_control';
  end if;

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  update online_table_voice_state
  set
    call_status = 'idle',
    call_started_by_group_player_id = null,
    call_started_at = null,
    active_speaker_group_player_id = null,
    floor_expires_at = null,
    updated_at = v_now
  where table_id = p_table_id
  returning * into v_voice;

  return jsonb_build_object(
    'ok', true,
    'call_status', coalesce(v_voice.call_status, 'idle')
  );
end;
$$;
