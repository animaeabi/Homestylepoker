-- Medium (audit): online_kick_table_player just vacated the seat, and the only
-- re-entry barrier was the 5-second join rate limit — so a kicked (or repeatedly
-- AFK) player could rejoin seconds later. Record a short ban on kick and reject
-- re-entry (join or claim) while it's active.

create table if not exists public.online_table_bans (
  table_id uuid not null references online_tables(id) on delete cascade,
  group_player_id uuid not null,
  banned_until timestamptz not null,
  primary key (table_id, group_player_id)
);

-- Bans are enforced only through SECURITY DEFINER functions; deny direct access.
alter table public.online_table_bans enable row level security;

create or replace function public.online_assert_not_banned(p_table_id uuid, p_group_player_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  perform 1
  from online_table_bans
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and banned_until > now();
  if found then
    raise exception 'kicked_from_table';
  end if;
end;
$function$;

-- online_kick_table_player is SECURITY INVOKER, so route the ban write (into the
-- RLS-protected online_table_bans) through a SECURITY DEFINER helper.
create or replace function public.online_record_table_ban(p_table_id uuid, p_group_player_id uuid, p_minutes integer default 10)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into online_table_bans(table_id, group_player_id, banned_until)
  values (p_table_id, p_group_player_id, now() + make_interval(mins => greatest(1, coalesce(p_minutes, 10))))
  on conflict (table_id, group_player_id)
  do update set banned_until = excluded.banned_until;
end;
$function$;

-- Kick: vacate the seat (existing behavior via online_leave_table) and record a
-- 10-minute ban so the host isn't fighting an instant re-join.
create or replace function public.online_kick_table_player(p_table_id uuid, p_actor_group_player_id uuid, p_actor_seat_token text, p_target_group_player_id uuid)
 returns online_table_seats
 language plpgsql
as $function$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_target_seat online_table_seats%rowtype;
  v_left online_table_seats%rowtype;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_table from online_tables where id = p_table_id for update;
  if not found then
    raise exception 'online_table_not_found';
  end if;

  select * into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
    and seat_token = p_actor_seat_token
  limit 1;
  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_only';
  end if;

  if p_target_group_player_id is null then
    raise exception 'target_player_required';
  end if;
  if p_target_group_player_id = p_actor_group_player_id then
    raise exception 'host_cannot_kick_self';
  end if;

  select * into v_target_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_target_group_player_id
    and left_at is null
  limit 1;
  if not found then
    raise exception 'target_player_not_seated';
  end if;

  perform online_record_table_ban(p_table_id, p_target_group_player_id, 10);

  select * into v_left
  from online_leave_table(p_table_id, p_target_group_player_id, v_target_seat.seat_token);

  return v_left;
end;
$function$;
-- Join: reject a banned player (non-bots only). Otherwise unchanged.
create or replace function public.online_join_table(p_table_id uuid, p_group_player_id uuid, p_preferred_seat integer default null::integer, p_chip_stack numeric default null::numeric, p_seat_token text default null::text, p_is_bot boolean default false, p_bot_personality text default null::text)
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

  if not coalesce(p_is_bot, false) then
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

-- Claim: also reject a banned player (keeps the seat-active guard from
-- 20260720140000).
create or replace function public.online_claim_table_seat(p_table_id uuid, p_group_player_id uuid)
 returns online_table_seats
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_table online_tables%rowtype;
  v_seat online_table_seats%rowtype;
  v_existing online_table_seats%rowtype;
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

  perform online_assert_not_banned(p_table_id, p_group_player_id);

  select * into v_existing
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
  order by joined_at asc
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_existing.last_seen_at is not null
     and v_existing.last_seen_at > now() - interval '30 seconds'
  then
    raise exception 'seat_active_elsewhere';
  end if;

  update online_table_seats
  set
    seat_token = encode(gen_random_bytes(16), 'hex'),
    joined_at = now(),
    last_seen_at = now()
  where id = v_existing.id
  returning * into v_seat;

  return v_seat;
end;
$function$;
