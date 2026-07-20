-- CRITICAL (audit): online_rebuy_chips accepted any p_amount — including
-- negative — and had no maximum, so a caller with the public anon key could
-- mint an arbitrary stack (or repeatedly top up with no ceiling). Validate the
-- amount is positive and cap the resulting stack at one starting stack (the
-- table's buy-in), never reducing a stack already above it from winnings.
create or replace function public.online_rebuy_chips(p_table_id uuid, p_group_player_id uuid, p_seat_token text, p_amount numeric default null::numeric)
 returns online_table_seats
 language plpgsql
 security definer
as $function$
declare
  v_table online_tables%rowtype;
  v_seat online_table_seats%rowtype;
  v_active_hand_id uuid;
  v_add numeric;
  v_cap numeric;
  v_new numeric;
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_table
  from online_tables
  where id = p_table_id;
  if not found then
    raise exception 'online_table_not_found';
  end if;

  select * into v_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
    and seat_token = p_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  select id into v_active_hand_id
  from online_hands
  where table_id = p_table_id
    and state not in ('settled', 'canceled')
  limit 1;

  if v_active_hand_id is not null then
    -- Allow rebuy if player is busted (stack = 0) even during active hand
    -- They'll join the next hand, not the current one
    if v_seat.chip_stack > 0 then
      raise exception 'cannot_rebuy_during_active_hand';
    end if;
  end if;

  v_add := online_normalize_money(coalesce(p_amount, v_table.starting_stack));
  if v_add <= 0 then
    raise exception 'rebuy_amount_invalid';
  end if;

  -- Max buy-in = one starting stack. Top up toward the cap without ever
  -- exceeding it, and never reduce a stack already above the cap (won chips).
  v_cap := online_normalize_money(greatest(coalesce(v_table.starting_stack, 200), 0));
  v_new := greatest(
    online_normalize_money(coalesce(v_seat.chip_stack, 0)),
    least(online_normalize_money(coalesce(v_seat.chip_stack, 0) + v_add), v_cap)
  );

  if v_new <= online_normalize_money(coalesce(v_seat.chip_stack, 0)) then
    raise exception 'already_at_max_buy_in';
  end if;

  update online_table_seats
  set chip_stack = v_new
  where id = v_seat.id
  returning * into v_seat;

  return v_seat;
end;
$function$;