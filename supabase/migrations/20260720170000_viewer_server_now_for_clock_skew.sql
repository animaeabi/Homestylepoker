-- Medium (audit): the decision-timer ring is computed from the device clock vs
-- the DB's last_action_at with no calibration, so a skewed client clock shows the
-- ring draining early/late and produces surprise auto-folds. Return the server's
-- clock in the two viewer payloads so the client can keep a rolling offset and
-- render the timer against server time.
create or replace function public.online_get_table_game_state_viewer(p_table_id uuid, p_viewer_group_player_id uuid default null::uuid, p_viewer_seat_token text default null::text, p_since_seq bigint default null::bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
begin
  perform online_refresh_seat_presence(p_table_id, p_viewer_group_player_id, p_viewer_seat_token, 60);

  select to_jsonb(t) into v_table from online_tables t where t.id = p_table_id;
  if v_table is null then
    raise exception 'online_table_not_found';
  end if;

  select coalesce(
    jsonb_agg(((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name)) order by s.seat_no),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id;

  select h.id into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state_viewer(v_hand_id, p_viewer_group_player_id, p_viewer_seat_token, p_since_seq);
  end if;

  return jsonb_build_object(
    'table', v_table,
    'seats', coalesce(v_seats, '[]'::jsonb),
    'latest_hand', coalesce(v_hand_state, '{}'::jsonb),
    'server_now', to_jsonb(now())
  );
end;
$function$;

create or replace function public.online_get_table_state_viewer(p_table_id uuid, p_viewer_group_player_id uuid default null::uuid, p_viewer_seat_token text default null::text, p_since_seq bigint default null::bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
  v_chat_messages jsonb := '[]'::jsonb;
  v_voice_state jsonb := '{}'::jsonb;
begin
  perform online_refresh_seat_presence(p_table_id, p_viewer_group_player_id, p_viewer_seat_token, 60);

  select to_jsonb(t) into v_table from online_tables t where t.id = p_table_id;
  if v_table is null then
    raise exception 'online_table_not_found';
  end if;

  select coalesce(
    jsonb_agg(((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name)) order by s.seat_no),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id;

  select h.id into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state_viewer(v_hand_id, p_viewer_group_player_id, p_viewer_seat_token, p_since_seq);
  end if;

  v_chat_messages := online_get_table_chat_messages(p_table_id, p_viewer_group_player_id, p_viewer_seat_token, 20);

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
    'voice_state', coalesce(v_voice_state, '{}'::jsonb),
    'server_now', to_jsonb(now())
  );
end;
$function$;