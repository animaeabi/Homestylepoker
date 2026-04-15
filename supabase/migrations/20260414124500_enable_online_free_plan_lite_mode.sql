-- Online free-plan-lite hardening:
-- - keep only the freshest online history
-- - trim chat retention aggressively
-- - shrink landing-page history payloads
-- - prune abandoned tables much sooner

drop function if exists online_get_table_chat_messages(uuid, uuid, text, int);
create or replace function online_get_table_chat_messages(
  p_table_id uuid,
  p_viewer_group_player_id uuid,
  p_viewer_seat_token text,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 20));
  v_messages jsonb;
begin
  if coalesce(nullif(trim(p_viewer_seat_token), ''), '') = '' then
    return '[]'::jsonb;
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_viewer_group_player_id
    and s.left_at is null
    and s.seat_token = p_viewer_seat_token
  limit 1;

  if not found then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(row_to_json(msg_row) order by msg_row.at asc),
    '[]'::jsonb
  )
  into v_messages
  from (
    select
      m.id,
      m.table_id,
      m.group_player_id as player_id,
      gp.name,
      m.message as text,
      m.created_at as at
    from online_table_chat_messages m
    left join group_players gp on gp.id = m.group_player_id
    where m.table_id = p_table_id
    order by m.created_at desc
    limit v_limit
  ) msg_row;

  return v_messages;
end;
$$;

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

drop function if exists online_list_table_summaries(text[], int);
create or replace function online_list_table_summaries(
  p_statuses text[] default null,
  p_limit int default 12
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with seat_counts as (
    select
      s.table_id,
      count(*)::int as seated_count
    from online_table_seats s
    where s.group_player_id is not null
      and s.left_at is null
    group by s.table_id
  ),
  settled_counts as (
    select
      h.table_id,
      count(*)::int as settled_hands
    from online_hands h
    where h.state = 'settled'
    group by h.table_id
  )
  select coalesce(
    jsonb_agg((to_jsonb(row_data) - 'sort_updated_at') order by row_data.sort_updated_at desc),
    '[]'::jsonb
  )
  from (
    select
      t.id,
      t.name,
      t.small_blind,
      t.big_blind,
      t.max_seats,
      t.starting_stack,
      t.status,
      t.created_at,
      t.updated_at,
      coalesce(seat_counts.seated_count, 0) as seated_count,
      coalesce(settled_counts.settled_hands, 0) as settled_hands,
      coalesce(t.updated_at, t.created_at) as sort_updated_at
    from online_tables t
    left join seat_counts on seat_counts.table_id = t.id
    left join settled_counts on settled_counts.table_id = t.id
    where (
      coalesce(array_length(p_statuses, 1), 0) = 0
      or t.status = any(p_statuses)
    )
      and (
        t.status <> 'closed'
        or coalesce(t.updated_at, t.created_at) >= now() - interval '72 hours'
      )
    order by coalesce(t.updated_at, t.created_at) desc
    limit greatest(least(coalesce(p_limit, 12), 12), 1)
  ) row_data;
$$;

drop function if exists online_post_table_chat_message(uuid, uuid, text, text);
create or replace function online_post_table_chat_message(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_message text
)
returns jsonb
language plpgsql
as $$
declare
  v_trimmed text := left(btrim(coalesce(p_message, '')), 180);
  v_message_id uuid;
  v_created_at timestamptz;
  v_actor_name text;
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  if v_trimmed = '' then
    raise exception 'chat_message_required';
  end if;

  perform online_check_chat_rate_limit(p_table_id, p_actor_group_player_id);

  perform 1
  from online_tables t
  where t.id = p_table_id;
  if not found then
    raise exception 'online_table_not_found';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  insert into online_table_chat_messages (
    table_id,
    group_player_id,
    message
  )
  values (
    p_table_id,
    p_actor_group_player_id,
    v_trimmed
  )
  returning id, created_at
  into v_message_id, v_created_at;

  select gp.name
  into v_actor_name
  from group_players gp
  where gp.id = p_actor_group_player_id;

  delete from online_table_chat_messages m
  where m.table_id = p_table_id
    and m.id in (
      select old_msg.id
      from online_table_chat_messages old_msg
      where old_msg.table_id = p_table_id
      order by old_msg.created_at desc
      offset 20
    );

  return jsonb_build_object(
    'id', v_message_id,
    'table_id', p_table_id,
    'player_id', p_actor_group_player_id,
    'name', coalesce(v_actor_name, 'Player'),
    'text', v_trimmed,
    'at', v_created_at
  );
end;
$$;

drop function if exists online_private.prune_online_data(int, int);
drop function if exists online_private.prune_online_data(int, int, int);
create or replace function online_private.prune_online_data(
  p_keep_recent_closed_tables int default 5,
  p_keep_closed_hours int default 72,
  p_idle_hours int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_keep_closed int := greatest(coalesce(p_keep_recent_closed_tables, 5), 0);
  v_keep_closed_hours int := greatest(coalesce(p_keep_closed_hours, 72), 1);
  v_idle_hours int := greatest(coalesce(p_idle_hours, 1), 1);
  v_deleted_closed int := 0;
  v_deleted_idle int := 0;
  v_trimmed_chat int := 0;
begin
  with ranked_closed as (
    select
      t.id,
      t.created_at,
      coalesce(t.updated_at, t.created_at) as touched_at,
      row_number() over (
        order by coalesce(t.updated_at, t.created_at) desc, t.created_at desc
      ) as rn
    from online_tables t
    where t.status = 'closed'
  ),
  doomed_closed as (
    select id
    from ranked_closed
    where rn > v_keep_closed
       or touched_at < now() - make_interval(hours => v_keep_closed_hours)
  ),
  deleted_closed as (
    delete from online_tables t
    using doomed_closed d
    where t.id = d.id
    returning t.id
  )
  select count(*) into v_deleted_closed
  from deleted_closed;

  with ranked_chat as (
    select
      m.id,
      m.created_at,
      row_number() over (
        partition by m.table_id
        order by m.created_at desc, m.id desc
      ) as rn
    from online_table_chat_messages m
  ),
  doomed_chat as (
    select id
    from ranked_chat
    where rn > 20
       or created_at < now() - interval '72 hours'
  ),
  deleted_chat as (
    delete from online_table_chat_messages m
    using doomed_chat d
    where m.id = d.id
    returning m.id
  )
  select count(*) into v_trimmed_chat
  from deleted_chat;

  with doomed_idle as (
    select t.id
    from online_tables t
    where t.status in ('waiting', 'active', 'paused')
      and coalesce(t.updated_at, t.created_at) < now() - make_interval(hours => v_idle_hours)
      and not exists (
        select 1
        from online_table_seats s
        where s.table_id = t.id
          and s.left_at is null
          and s.group_player_id is not null
      )
      and not exists (
        select 1
        from online_hands h
        where h.table_id = t.id
          and h.state not in ('settled', 'canceled')
      )
  ),
  deleted_idle as (
    delete from online_tables t
    using doomed_idle d
    where t.id = d.id
    returning t.id
  )
  select count(*) into v_deleted_idle
  from deleted_idle;

  return jsonb_build_object(
    'deleted_closed_tables', v_deleted_closed,
    'deleted_idle_tables', v_deleted_idle,
    'trimmed_chat_messages', v_trimmed_chat,
    'kept_recent_closed_tables', v_keep_closed,
    'closed_hours_threshold', v_keep_closed_hours,
    'idle_hours_threshold', v_idle_hours
  );
end;
$$;

grant execute on function online_private.prune_online_data(int, int, int) to service_role;

do $$
begin
  perform online_private.prune_online_data(5, 72, 1);
end;
$$;

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'online-history-retention'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'online-history-retention',
    '17 */6 * * *',
    $job$select online_private.prune_online_data(5, 72, 1);$job$
  );
end
$cron$;
