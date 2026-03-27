-- Follow-up to the online security gate:
-- 1) harden SECURITY DEFINER reader functions with fixed search_path
-- 2) add safe summary RPCs so landing-page Online Games/history UI
--    no longer reads online_hands / online_hand_players directly.

alter function online_get_hand_state_viewer(uuid, uuid, text, bigint) security definer;
alter function online_get_hand_state_viewer(uuid, uuid, text, bigint) set search_path = public, pg_temp;

alter function online_get_table_chat_messages(uuid, uuid, text, int) security definer;
alter function online_get_table_chat_messages(uuid, uuid, text, int) set search_path = public, pg_temp;

alter function online_get_table_state_viewer(uuid, uuid, text, bigint) security definer;
alter function online_get_table_state_viewer(uuid, uuid, text, bigint) set search_path = public, pg_temp;

alter function online_get_table_game_state_viewer(uuid, uuid, text, bigint) security definer;
alter function online_get_table_game_state_viewer(uuid, uuid, text, bigint) set search_path = public, pg_temp;

alter function online_post_action_continuation(uuid) security definer;
alter function online_post_action_continuation(uuid) set search_path = public, pg_temp;

drop function if exists online_list_table_summaries(text[], int);
create or replace function online_list_table_summaries(
  p_statuses text[] default null,
  p_limit int default 50
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
    where coalesce(array_length(p_statuses, 1), 0) = 0
       or t.status = any(p_statuses)
    order by coalesce(t.updated_at, t.created_at) desc
    limit greatest(coalesce(p_limit, 50), 1)
  ) row_data;
$$;

drop function if exists online_get_table_results_summary(uuid);
create or replace function online_get_table_results_summary(
  p_table_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with target_table as (
    select
      t.id,
      t.name,
      t.small_blind,
      t.big_blind,
      t.max_seats,
      t.starting_stack,
      t.status,
      t.created_at,
      t.updated_at
    from online_tables t
    where t.id = p_table_id
  ),
  settled_hands as (
    select
      h.id,
      h.hand_no
    from online_hands h
    where h.table_id = p_table_id
      and h.state = 'settled'
  ),
  ordered_hp as (
    select
      hp.group_player_id,
      sh.hand_no,
      coalesce(hp.stack_start, 0)::numeric as stack_start,
      coalesce(hp.stack_end, 0)::numeric as stack_end,
      lag(coalesce(hp.stack_end, 0)::numeric) over (
        partition by hp.group_player_id
        order by sh.hand_no
      ) as prev_stack_end
    from online_hand_players hp
    join settled_hands sh on sh.id = hp.hand_id
    where hp.group_player_id is not null
  ),
  player_results as (
    select
      ohp.group_player_id,
      sum(
        case
          when ohp.prev_stack_end is null then ohp.stack_start
          when ohp.stack_start > coalesce(ohp.prev_stack_end, 0) then ohp.stack_start - coalesce(ohp.prev_stack_end, 0)
          else 0
        end
      ) as buy_in,
      (array_agg(ohp.stack_end order by ohp.hand_no desc))[1] as cash_out,
      count(*)::int as hands
    from ordered_hp ohp
    group by ohp.group_player_id
  ),
  players_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_player_id', pr.group_player_id,
          'name', coalesce(gp.name, 'Player'),
          'buy_in', online_normalize_money(pr.buy_in),
          'cash_out', online_normalize_money(pr.cash_out),
          'net', online_normalize_money(pr.cash_out - pr.buy_in),
          'hands', pr.hands
        )
        order by online_normalize_money(pr.cash_out - pr.buy_in) desc, coalesce(gp.name, 'Player') asc
      ),
      '[]'::jsonb
    ) as players
    from player_results pr
    left join group_players gp on gp.id = pr.group_player_id
  ),
  counts as (
    select count(*)::int as settled_hand_count
    from settled_hands
  )
  select
    case
      when exists(select 1 from target_table) then jsonb_build_object(
        'table', (select to_jsonb(t) from target_table t),
        'settled_hand_count', (select settled_hand_count from counts),
        'players', (select players from players_json)
      )
      else null
    end;
$$;
