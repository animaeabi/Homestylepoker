-- Emergency online-data retention pass to get the project back under
-- Supabase DB size / egress limits without touching in-person tracker data.
--
-- Strategy:
-- 1) keep only a small recent slice of closed online tables
-- 2) delete older closed tables (cascades hands/events/snapshots/actions/chat/voice)
-- 3) delete abandoned waiting/active/paused tables with no seated players
-- 4) install a daily retention cron so the online dataset stays bounded

create or replace function online_private.prune_online_data(
  p_keep_recent_closed_tables int default 25,
  p_idle_hours int default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_keep_closed int := greatest(coalesce(p_keep_recent_closed_tables, 25), 0);
  v_idle_hours int := greatest(coalesce(p_idle_hours, 12), 1);
  v_deleted_closed int := 0;
  v_deleted_idle int := 0;
begin
  with ranked_closed as (
    select
      t.id,
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
  ),
  deleted_closed as (
    delete from online_tables t
    using doomed_closed d
    where t.id = d.id
    returning t.id
  )
  select count(*) into v_deleted_closed
  from deleted_closed;

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
    'kept_recent_closed_tables', v_keep_closed,
    'idle_hours_threshold', v_idle_hours
  );
end;
$$;

do $$
begin
  perform online_private.prune_online_data(25, 12);
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
    '17 9 * * *',
    $job$select online_private.prune_online_data(40, 24);$job$
  );
end
$cron$;
