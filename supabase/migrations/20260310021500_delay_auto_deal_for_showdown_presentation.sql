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
    and coalesce(lh.ended_at, now()) <= now() - make_interval(secs => greatest(coalesce(t.showdown_delay_secs, 5), 1) + 2)
    and not exists (
      select 1
      from online_hands active_hand
      where active_hand.table_id = t.id
        and active_hand.state not in ('settled', 'canceled')
    )
  order by lh.ended_at asc nulls last
  limit greatest(coalesce(p_limit, 24), 1);
$$;
