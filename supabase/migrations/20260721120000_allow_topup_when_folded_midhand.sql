-- Allow a short-stacked player to top up as soon as they've folded, instead of
-- only after the whole hand settles.
--
-- Previously online_rebuy_chips blocked any rebuy while a hand was active if the
-- seat still had chips (chip_stack > 0), so a folded player with a short stack
-- had to wait for the hand to finish. Now the block only applies while the
-- player is still LIVE in the hand (not folded) -- they could still act on or
-- win the pot. Folded players, and players not dealt into the current hand, may
-- top up for the next hand.
--
-- Because settlement copies each hand player's stack_end back onto the seat, a
-- mid-hand top-up would be wiped at settle; so when the player has already
-- folded this hand we mirror the added chips into their stack_end as well.

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
  v_prev numeric;
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

  -- Only block a rebuy when the player is still LIVE in the active hand (could
  -- still act on, or win, the pot). A folded player -- or one not dealt into the
  -- current hand -- may top up now for the next hand.
  if v_active_hand_id is not null then
    if exists (
      select 1 from online_hand_players hp
      where hp.hand_id = v_active_hand_id
        and hp.group_player_id = p_group_player_id
        and not hp.folded
    ) then
      raise exception 'cannot_rebuy_during_active_hand';
    end if;
  end if;

  v_add := online_normalize_money(coalesce(p_amount, v_table.starting_stack));
  if v_add <= 0 then
    raise exception 'rebuy_amount_invalid';
  end if;

  v_prev := online_normalize_money(coalesce(v_seat.chip_stack, 0));
  v_cap := online_normalize_money(greatest(coalesce(v_table.starting_stack, 200), 0));
  v_new := greatest(v_prev, least(online_normalize_money(v_prev + v_add), v_cap));

  if v_new <= v_prev then
    raise exception 'already_at_max_buy_in';
  end if;

  update online_table_seats
  set chip_stack = v_new
  where id = v_seat.id
  returning * into v_seat;

  -- If the player has already folded this hand, mirror the added chips into their
  -- hand-player stack as well. Settlement copies stack_end back onto the seat, so
  -- without this the top-up would be wiped the moment the hand ends.
  if v_active_hand_id is not null then
    update online_hand_players
    set stack_end = online_normalize_money(coalesce(stack_end, 0) + (v_new - v_prev))
    where hand_id = v_active_hand_id
      and group_player_id = p_group_player_id
      and folded;
  end if;

  return v_seat;
end;
$function$;

grant execute on function public.online_rebuy_chips(uuid, uuid, text, numeric) to anon, authenticated;
