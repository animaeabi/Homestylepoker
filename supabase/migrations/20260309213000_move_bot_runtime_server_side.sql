alter table online_table_seats
  add column if not exists bot_personality text;

alter table online_table_seats
  add column if not exists bot_rebuy_count int not null default 0;

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
    and coalesce(lh.ended_at, now()) <= now() - make_interval(secs => greatest(coalesce(t.showdown_delay_secs, 5), 1))
    and not exists (
      select 1
      from online_hands active_hand
      where active_hand.table_id = t.id
        and active_hand.state not in ('settled', 'canceled')
    )
  order by lh.ended_at asc nulls last
  limit greatest(coalesce(p_limit, 24), 1);
$$;

drop function if exists online_join_table(uuid, uuid, int, numeric);
drop function if exists online_join_table(uuid, uuid, int, numeric, text);
drop function if exists online_join_table(uuid, uuid, int, numeric, text, boolean);
drop function if exists online_join_table(uuid, uuid, int, numeric, text, boolean, text);
create or replace function online_join_table(
  p_table_id uuid,
  p_group_player_id uuid,
  p_preferred_seat int default null,
  p_chip_stack numeric default null,
  p_seat_token text default null,
  p_is_bot boolean default false,
  p_bot_personality text default null
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_existing online_table_seats%rowtype;
  v_joined online_table_seats%rowtype;
  v_stack numeric;
begin
  select * into v_table from online_tables where id = p_table_id for update;
  if not found then
    raise exception 'online_table_not_found';
  end if;
  if v_table.status = 'closed' then
    raise exception 'online_table_closed';
  end if;

  perform 1
  from group_players
  where id = p_group_player_id
    and group_id = v_table.group_id
    and archived_at is null;
  if not found then
    raise exception 'player_not_eligible_for_group';
  end if;

  v_stack := coalesce(p_chip_stack, v_table.starting_stack, 200);

  insert into online_table_seats(table_id, seat_no, chip_stack)
  select p_table_id, gs, 0
  from generate_series(1, v_table.max_seats) as gs
  on conflict (table_id, seat_no) do nothing;

  select * into v_existing
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
  limit 1;
  if found then
    if coalesce(nullif(trim(p_seat_token), ''), '') <> '' and p_seat_token = v_existing.seat_token then
      return v_existing;
    end if;
    raise exception 'player_already_seated_claim_required';
  end if;

  if p_preferred_seat is not null then
    if p_preferred_seat < 1 or p_preferred_seat > v_table.max_seats then
      raise exception 'preferred_seat_out_of_range';
    end if;

    update online_table_seats
    set
      group_player_id = p_group_player_id,
      chip_stack = greatest(v_stack, 0),
      is_bot = coalesce(p_is_bot, false),
      bot_personality = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_personality), '') else null end,
      bot_rebuy_count = 0,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
      joined_at = now(),
      left_at = null
    where id in (
      select id
      from online_table_seats
      where table_id = p_table_id
        and seat_no = p_preferred_seat
        and (group_player_id is null or left_at is not null)
      for update skip locked
      limit 1
    )
    returning * into v_joined;
  else
    update online_table_seats
    set
      group_player_id = p_group_player_id,
      chip_stack = greatest(v_stack, 0),
      is_bot = coalesce(p_is_bot, false),
      bot_personality = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_personality), '') else null end,
      bot_rebuy_count = 0,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
      joined_at = now(),
      left_at = null
    where id in (
      select id
      from online_table_seats
      where table_id = p_table_id
        and (group_player_id is null or left_at is not null)
      order by seat_no
      for update skip locked
      limit 1
    )
    returning * into v_joined;
  end if;

  if not found then
    raise exception 'online_table_full_or_seat_taken';
  end if;

  return v_joined;
end;
$$;
