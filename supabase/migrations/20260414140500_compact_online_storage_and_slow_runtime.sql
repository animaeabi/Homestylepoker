-- Aggressive online storage recovery for free-tier survival:
-- 1) tighten summary visibility + ongoing retention
-- 2) slow the fallback runtime cron to reduce future Edge + cron churn
-- 3) bulk-compact oversized online history tables by rewriting them in place
-- 4) clear extension-owned runtime history tables that grew with the 2-second loop

set statement_timeout = '0';

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
        or coalesce(t.updated_at, t.created_at) >= now() - interval '24 hours'
      )
    order by coalesce(t.updated_at, t.created_at) desc
    limit greatest(least(coalesce(p_limit, 12), 12), 1)
  ) row_data;
$$;

drop function if exists online_private.prune_online_data(int, int);
drop function if exists online_private.prune_online_data(int, int, int);
create or replace function online_private.prune_online_data(
  p_keep_recent_closed_tables int default 3,
  p_keep_closed_hours int default 24,
  p_idle_hours int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_keep_closed int := greatest(coalesce(p_keep_recent_closed_tables, 3), 0);
  v_keep_closed_hours int := greatest(coalesce(p_keep_closed_hours, 24), 1);
  v_idle_hours int := greatest(coalesce(p_idle_hours, 1), 1);
  v_keep_live_final_hands int := 60;
  v_keep_artifact_hands int := 3;
  v_deleted_closed int := 0;
  v_deleted_live_hands int := 0;
  v_deleted_idle int := 0;
  v_trimmed_actions int := 0;
  v_trimmed_events int := 0;
  v_trimmed_snapshots int := 0;
  v_trimmed_chat int := 0;
  v_trimmed_cron_history int := 0;
  v_trimmed_http_history int := 0;
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

  with ranked_live_final_hands as (
    select
      h.id,
      row_number() over (
        partition by h.table_id
        order by h.hand_no desc
      ) as rn
    from online_hands h
    join online_tables t on t.id = h.table_id
    where t.status <> 'closed'
      and h.state in ('settled', 'canceled')
  ),
  doomed_live_hands as (
    select id
    from ranked_live_final_hands
    where rn > v_keep_live_final_hands
  ),
  deleted_live_hands as (
    delete from online_hands h
    using doomed_live_hands d
    where h.id = d.id
    returning h.id
  )
  select count(*) into v_deleted_live_hands
  from deleted_live_hands;

  with retained_artifact_hands as (
    select id
    from (
      select
        h.id,
        row_number() over (
          partition by h.table_id
          order by h.hand_no desc
        ) as rn
      from online_hands h
    ) ranked
    where rn <= v_keep_artifact_hands
  ),
  doomed_actions as (
    select a.id
    from online_actions a
    join online_hands h on h.id = a.hand_id
    where h.state in ('settled', 'canceled')
      and not exists (
        select 1
        from retained_artifact_hands kept
        where kept.id = h.id
      )
  ),
  deleted_actions as (
    delete from online_actions a
    using doomed_actions d
    where a.id = d.id
    returning a.id
  )
  select count(*) into v_trimmed_actions
  from deleted_actions;

  with retained_artifact_hands as (
    select id
    from (
      select
        h.id,
        row_number() over (
          partition by h.table_id
          order by h.hand_no desc
        ) as rn
      from online_hands h
    ) ranked
    where rn <= v_keep_artifact_hands
  ),
  doomed_events as (
    select ev.id
    from online_hand_events ev
    join online_hands h on h.id = ev.hand_id
    where h.state in ('settled', 'canceled')
      and not exists (
        select 1
        from retained_artifact_hands kept
        where kept.id = h.id
      )
  ),
  deleted_events as (
    delete from online_hand_events ev
    using doomed_events d
    where ev.id = d.id
    returning ev.id
  )
  select count(*) into v_trimmed_events
  from deleted_events;

  with retained_artifact_hands as (
    select id
    from (
      select
        h.id,
        row_number() over (
          partition by h.table_id
          order by h.hand_no desc
        ) as rn
      from online_hands h
    ) ranked
    where rn <= v_keep_artifact_hands
  ),
  doomed_snapshots as (
    select s.id
    from online_hand_snapshots s
    join online_hands h on h.id = s.hand_id
    where h.state in ('settled', 'canceled')
      and not exists (
        select 1
        from retained_artifact_hands kept
        where kept.id = h.id
      )
  ),
  deleted_snapshots as (
    delete from online_hand_snapshots s
    using doomed_snapshots d
    where s.id = d.id
    returning s.id
  )
  select count(*) into v_trimmed_snapshots
  from deleted_snapshots;

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
       or created_at < now() - interval '24 hours'
  ),
  deleted_chat as (
    delete from online_table_chat_messages m
    using doomed_chat d
    where m.id = d.id
    returning m.id
  )
  select count(*) into v_trimmed_chat
  from deleted_chat;

  begin
    delete from cron.job_run_details jd
    where coalesce(jd.end_time, jd.start_time, now()) < now() - interval '24 hours';
    get diagnostics v_trimmed_cron_history = row_count;
  exception
    when undefined_table or insufficient_privilege then
      v_trimmed_cron_history := 0;
  end;

  begin
    delete from net._http_response r
    where r.created < now() - interval '6 hours';
    get diagnostics v_trimmed_http_history = row_count;
  exception
    when undefined_table or insufficient_privilege then
      v_trimmed_http_history := 0;
  end;

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
    'deleted_live_final_hands', v_deleted_live_hands,
    'deleted_idle_tables', v_deleted_idle,
    'trimmed_actions', v_trimmed_actions,
    'trimmed_events', v_trimmed_events,
    'trimmed_snapshots', v_trimmed_snapshots,
    'trimmed_chat_messages', v_trimmed_chat,
    'trimmed_cron_history_rows', v_trimmed_cron_history,
    'trimmed_http_history_rows', v_trimmed_http_history,
    'kept_recent_closed_tables', v_keep_closed,
    'closed_hours_threshold', v_keep_closed_hours,
    'idle_hours_threshold', v_idle_hours,
    'kept_live_final_hands_per_table', v_keep_live_final_hands,
    'kept_artifact_hands_per_table', v_keep_artifact_hands
  );
end;
$$;

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
    '10 seconds',
    $job$select online_dispatch_edge_runtime();$job$
  );
end
$cron$;

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
    '17 * * * *',
    $job$select online_private.prune_online_data(3, 24, 1);$job$
  );
end
$cron$;

do $$
begin
  begin
    truncate table cron.job_run_details;
  exception
    when undefined_table or insufficient_privilege then
      null;
  end;

  begin
    truncate table net._http_response;
  exception
    when undefined_table or insufficient_privilege then
      null;
  end;
end;
$$;

do $$
begin
  create temp table tmp_keep_tables on commit drop as
  with ranked_closed as (
    select
      t.id,
      row_number() over (
        order by coalesce(t.updated_at, t.created_at) desc, t.created_at desc
      ) as rn
    from online_tables t
    where t.status = 'closed'
      and coalesce(t.updated_at, t.created_at) >= now() - interval '24 hours'
  ),
  keep_closed as (
    select id
    from ranked_closed
    where rn <= 3
  ),
  keep_live as (
    select t.id
    from online_tables t
    where t.status <> 'closed'
      and not (
        coalesce(t.updated_at, t.created_at) < now() - interval '1 hour'
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
      )
  )
  select id from keep_closed
  union
  select id from keep_live;

  create temp table tmp_keep_hands on commit drop as
  with ranked_live_final_hands as (
    select
      h.id,
      row_number() over (
        partition by h.table_id
        order by h.hand_no desc
      ) as rn
    from online_hands h
    join online_tables t on t.id = h.table_id
    join tmp_keep_tables kt on kt.id = t.id
    where t.status <> 'closed'
      and h.state in ('settled', 'canceled')
  )
  select distinct id
  from (
    select h.id
    from online_hands h
    join online_tables t on t.id = h.table_id
    join tmp_keep_tables kt on kt.id = t.id
    where t.status = 'closed'

    union

    select h.id
    from online_hands h
    join online_tables t on t.id = h.table_id
    join tmp_keep_tables kt on kt.id = t.id
    where h.state not in ('settled', 'canceled')

    union

    select id
    from ranked_live_final_hands
    where rn <= 60
  ) keep_hands;

  create temp table tmp_artifact_hands on commit drop as
  with ranked_artifact_hands as (
    select
      h.id,
      row_number() over (
        partition by h.table_id
        order by h.hand_no desc
      ) as rn
    from online_hands h
    where h.id in (select id from tmp_keep_hands)
  )
  select distinct id
  from (
    select id
    from ranked_artifact_hands
    where rn <= 3

    union

    select h.id
    from online_hands h
    where h.state not in ('settled', 'canceled')
  ) keep_artifacts;

  create temp table tmp_online_hands on commit drop as
  select *
  from online_hands
  where id in (select id from tmp_keep_hands);

  create temp table tmp_online_hand_players on commit drop as
  select *
  from online_hand_players
  where hand_id in (select id from tmp_keep_hands);

  create temp table tmp_online_hand_events on commit drop as
  select *
  from online_hand_events
  where hand_id in (select id from tmp_artifact_hands);

  create temp table tmp_online_hand_snapshots on commit drop as
  select *
  from online_hand_snapshots
  where hand_id in (select id from tmp_artifact_hands);

  create temp table tmp_online_actions on commit drop as
  select *
  from online_actions
  where hand_id in (select id from tmp_artifact_hands);

  create temp table tmp_online_table_chat_messages on commit drop as
  with ranked_chat as (
    select
      m.*,
      row_number() over (
        partition by m.table_id
        order by m.created_at desc, m.id desc
      ) as rn
    from online_table_chat_messages m
    join tmp_keep_tables kt on kt.id = m.table_id
  )
  select id, table_id, group_player_id, message, created_at
  from ranked_chat
  where rn <= 20
    and created_at >= now() - interval '24 hours';

  truncate table
    online_table_chat_messages,
    online_actions,
    online_hand_snapshots,
    online_hand_events,
    online_hand_players,
    online_hands;

  insert into online_hands
  select *
  from tmp_online_hands
  order by table_id, hand_no;

  insert into online_hand_players
  select *
  from tmp_online_hand_players
  order by hand_id, seat_no;

  insert into online_hand_events
  select *
  from tmp_online_hand_events
  order by id;

  insert into online_hand_snapshots
  select *
  from tmp_online_hand_snapshots
  order by hand_id, seq;

  insert into online_actions
  select *
  from tmp_online_actions
  order by created_at, id;

  insert into online_table_chat_messages
  select *
  from tmp_online_table_chat_messages
  order by table_id, created_at, id;

  delete from online_tables t
  where not exists (
    select 1
    from tmp_keep_tables kt
    where kt.id = t.id
  );

  perform setval(
    pg_get_serial_sequence('online_hand_events', 'id'),
    greatest(coalesce((select max(id) from online_hand_events), 0), 1),
    true
  );
end;
$$;
