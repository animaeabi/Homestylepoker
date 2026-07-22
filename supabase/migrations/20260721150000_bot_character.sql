-- Signature bot characters: each bot becomes one of the 10 fixed parody
-- poker-pro characters. The character id drives BOTH the on-table display
-- (client resolves it to a portrait + parody name + flavor card) and the
-- server play style (runtime resolves it in _shared/characters.ts and feeds
-- the base personality + profile/preflop overrides into decideBotAction).
--
-- Here we just persist which character a bot seat is. It sits alongside
-- bot_personality (kept for backward compatibility / non-character bots) and
-- is set only when a bot joins.

alter table online_table_seats
  add column if not exists bot_character text;

-- Recreate online_join_table with a p_bot_character passthrough. Mirrors the
-- current live 9-param definition (security definer, host check, ban check)
-- and just threads the character id into both seat-claim branches.
drop function if exists public.online_join_table(uuid, uuid, integer, numeric, text, boolean, text);
drop function if exists public.online_join_table(uuid, uuid, integer, numeric, text, boolean, text, uuid, uuid);

create or replace function public.online_join_table(
  p_table_id uuid,
  p_group_player_id uuid,
  p_preferred_seat integer default null::integer,
  p_chip_stack numeric default null::numeric,
  p_seat_token text default null::text,
  p_is_bot boolean default false,
  p_bot_personality text default null::text,
  p_actor_group_player_id uuid default null::uuid,
  p_actor_seat_token text default null::text,
  p_bot_character text default null::text
)
 returns online_table_seats
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_table online_tables%rowtype;
  v_existing online_table_seats%rowtype;
  v_joined online_table_seats%rowtype;
  v_stack numeric;
begin
  if not coalesce(p_is_bot, false) then
    perform online_check_join_rate_limit(p_table_id, p_group_player_id);
  end if;

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

  if coalesce(p_is_bot, false) then
    perform online_assert_bot_join_allowed(p_table_id, p_actor_group_player_id, p_actor_seat_token);
  else
    perform online_assert_not_banned(p_table_id, p_group_player_id);
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
      bot_character = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_character), '') else null end,
      bot_rebuy_count = case when coalesce(p_is_bot, false) then 0 else 0 end,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
      joined_at = now(),
      last_seen_at = now(),
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
      bot_character = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_character), '') else null end,
      bot_rebuy_count = case when coalesce(p_is_bot, false) then 0 else 0 end,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
      joined_at = now(),
      last_seen_at = now(),
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

  if v_table.status = 'waiting' then
    update online_tables set status = 'active' where id = p_table_id;
  end if;

  if not coalesce(p_is_bot, false)
     and online_active_human_host_group_player(p_table_id) is null
  then
    perform online_prune_bot_seats(p_table_id);
    update online_tables
    set created_by_group_player_id = online_first_active_human_group_player(p_table_id)
    where id = p_table_id
      and online_active_human_host_group_player(p_table_id) is null;
  end if;

  return v_joined;
end;
$function$;
