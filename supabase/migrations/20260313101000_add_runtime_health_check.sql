drop function if exists online_runtime_health_check(int, int);
create or replace function online_runtime_health_check(
  p_limit int default 20,
  p_grace_secs int default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_role text := coalesce(online_request_role(), '');
  v_dispatch_ready boolean := false;
  v_processable_count int := 0;
  v_due_table_count int := 0;
  v_stale_hands jsonb := '[]'::jsonb;
begin
  if v_role <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'service_role_required';
  end if;

  v_dispatch_ready := coalesce(online_private.get_supabase_anon_key(), '') <> ''
    and coalesce(online_private.get_runtime_dispatch_secret(), '') <> '';

  select count(*)
  into v_processable_count
  from online_runtime_processable_hands(null, greatest(coalesce(p_limit, 20), 1));

  select count(*)
  into v_due_table_count
  from online_runtime_due_tables(greatest(coalesce(p_limit, 20), 1));

  with runtime_hands as (
    select
      h.id as hand_id,
      h.table_id,
      t.name as table_name,
      h.hand_no,
      h.state,
      h.action_seat,
      coalesce(h.last_action_at, h.started_at, now()) as anchor_at,
      case
        when h.state = 'showdown'
          then greatest(coalesce(t.showdown_delay_secs, 5), 1) + 2
        else greatest(coalesce(t.decision_time_secs, 25), 10)
      end as expected_secs
    from online_hands h
    join online_tables t on t.id = h.table_id
    where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
      and t.status <> 'closed'
  ),
  stale_candidates as (
    select
      rh.*,
      greatest(floor(extract(epoch from (now() - rh.anchor_at)))::int, 0) as age_secs
    from runtime_hands rh
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_id', sc.table_id,
        'table_name', sc.table_name,
        'hand_id', sc.hand_id,
        'hand_no', sc.hand_no,
        'state', sc.state,
        'action_seat', sc.action_seat,
        'age_secs', sc.age_secs,
        'expected_secs', sc.expected_secs,
        'grace_secs', greatest(coalesce(p_grace_secs, 15), 0),
        'seconds_overdue', greatest(sc.age_secs - sc.expected_secs - greatest(coalesce(p_grace_secs, 15), 0), 0),
        'reason', case
          when sc.state = 'showdown' then 'showdown_settlement_overdue'
          else 'turn_timeout_overdue'
        end
      )
      order by greatest(sc.age_secs - sc.expected_secs - greatest(coalesce(p_grace_secs, 15), 0), 0) desc, sc.anchor_at asc
    ),
    '[]'::jsonb
  )
  into v_stale_hands
  from (
    select *
    from stale_candidates
    where age_secs > expected_secs + greatest(coalesce(p_grace_secs, 15), 0)
    order by age_secs desc, anchor_at asc
    limit greatest(coalesce(p_limit, 20), 1)
  ) sc;

  return jsonb_build_object(
    'checked_at', now(),
    'dispatch_ready', v_dispatch_ready,
    'processable_count', v_processable_count,
    'due_table_count', v_due_table_count,
    'stale_hands', v_stale_hands
  );
end;
$$;

grant execute on function online_runtime_health_check(int, int) to service_role;
