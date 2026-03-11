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
    'active',
    p_actor_group_player_id,
    v_now,
    null,
    null,
    v_now
  )
  on conflict (table_id) do update
    set
      call_status = 'active',
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
