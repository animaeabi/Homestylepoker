-- CRITICAL (audit): online_claim_table_seat reissues a seat's token with NO
-- ownership check. Because online identity is just a lowercased display name,
-- a second person joining with a name that matches a seated player triggers the
-- client's auto-claim, silently stealing the seat (and its chips) and bumping
-- the original player out with seat_token_invalid.
--
-- Fix: refuse to reissue the token while the seat is actively present. The
-- viewer RPCs refresh last_seen_at roughly every second for an open, focused
-- tab, so a fresh last_seen_at means someone is actively holding the seat. A
-- genuine reclaim (own device after clearing storage, or returning after being
-- away) still works once presence has lapsed; the 5-minute stale-seat reaper
-- and normal token-based restore cover those cases without opening the steal.
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

  -- Guard against name-collision seat theft: if the seat is actively present,
  -- someone is holding it right now — do not hand it (and its chips) to a
  -- same-named joiner.
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