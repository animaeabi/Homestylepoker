create table if not exists online_table_voice_state (
  table_id uuid primary key references online_tables(id) on delete cascade,
  active_speaker_group_player_id uuid references group_players(id) on delete set null,
  floor_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

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
      'is_active', (vs.active_speaker_group_player_id is not null and coalesce(vs.floor_expires_at, now()) > now())
    ),
    '{}'::jsonb
  )
  into v_voice_state
  from online_table_voice_state vs
  left join group_players gp on gp.id = vs.active_speaker_group_player_id
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

drop function if exists online_claim_voice_floor(uuid, uuid, text, int);
create or replace function online_claim_voice_floor(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_ttl_secs int default 6
)
returns jsonb
language plpgsql
as $$
declare
  v_ttl_secs int := greatest(3, least(coalesce(p_ttl_secs, 6), 15));
  v_floor online_table_voice_state%rowtype;
  v_current_name text;
  v_actor_name text;
  v_now timestamptz := now();
  v_current_active boolean := false;
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

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  select *
  into v_floor
  from online_table_voice_state
  where table_id = p_table_id
  for update;

  v_current_active := (
    v_floor.active_speaker_group_player_id is not null
    and coalesce(v_floor.floor_expires_at, v_now) > v_now
    and exists (
      select 1
      from online_table_seats s
      where s.table_id = p_table_id
        and s.group_player_id = v_floor.active_speaker_group_player_id
        and s.left_at is null
        and not coalesce(s.is_bot, false)
    )
  );

  if not v_current_active or v_floor.active_speaker_group_player_id = p_actor_group_player_id then
    update online_table_voice_state
    set
      active_speaker_group_player_id = p_actor_group_player_id,
      floor_expires_at = v_now + make_interval(secs => v_ttl_secs),
      updated_at = v_now
    where table_id = p_table_id
    returning * into v_floor;
    v_current_active := true;
  end if;

  select gp.name into v_current_name
  from group_players gp
  where gp.id = v_floor.active_speaker_group_player_id;

  select gp.name into v_actor_name
  from group_players gp
  where gp.id = p_actor_group_player_id;

  return jsonb_build_object(
    'granted', (v_floor.active_speaker_group_player_id = p_actor_group_player_id),
    'speaker_player_id', v_floor.active_speaker_group_player_id,
    'speaker_name', coalesce(v_current_name, v_actor_name, 'Player'),
    'floor_expires_at', v_floor.floor_expires_at,
    'is_active', v_current_active
  );
end;
$$;

drop function if exists online_refresh_voice_floor(uuid, uuid, text, int);
create or replace function online_refresh_voice_floor(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_ttl_secs int default 6
)
returns jsonb
language plpgsql
as $$
declare
  v_ttl_secs int := greatest(3, least(coalesce(p_ttl_secs, 6), 15));
  v_floor online_table_voice_state%rowtype;
  v_name text;
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

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  update online_table_voice_state
  set
    floor_expires_at = v_now + make_interval(secs => v_ttl_secs),
    updated_at = v_now
  where table_id = p_table_id
    and active_speaker_group_player_id = p_actor_group_player_id
  returning * into v_floor;

  if not found then
    select *
    into v_floor
    from online_table_voice_state
    where table_id = p_table_id;
  end if;

  select gp.name into v_name
  from group_players gp
  where gp.id = v_floor.active_speaker_group_player_id;

  return jsonb_build_object(
    'granted', (v_floor.active_speaker_group_player_id = p_actor_group_player_id and coalesce(v_floor.floor_expires_at, v_now) > v_now),
    'speaker_player_id', v_floor.active_speaker_group_player_id,
    'speaker_name', coalesce(v_name, 'Player'),
    'floor_expires_at', v_floor.floor_expires_at,
    'is_active', (v_floor.active_speaker_group_player_id is not null and coalesce(v_floor.floor_expires_at, v_now) > v_now)
  );
end;
$$;

drop function if exists online_release_voice_floor(uuid, uuid, text);
create or replace function online_release_voice_floor(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_floor online_table_voice_state%rowtype;
  v_name text;
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

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  update online_table_voice_state
  set
    active_speaker_group_player_id = null,
    floor_expires_at = null,
    updated_at = v_now
  where table_id = p_table_id
    and active_speaker_group_player_id = p_actor_group_player_id
  returning * into v_floor;

  if not found then
    select *
    into v_floor
    from online_table_voice_state
    where table_id = p_table_id;
  end if;

  select gp.name into v_name
  from group_players gp
  where gp.id = v_floor.active_speaker_group_player_id;

  return jsonb_build_object(
    'released', true,
    'speaker_player_id', v_floor.active_speaker_group_player_id,
    'speaker_name', v_name,
    'floor_expires_at', v_floor.floor_expires_at,
    'is_active', false
  );
end;
$$;
