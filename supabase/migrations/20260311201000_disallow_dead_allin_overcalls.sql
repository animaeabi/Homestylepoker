drop function if exists online_submit_action(uuid, uuid, text, numeric, text);
drop function if exists online_submit_action(uuid, uuid, text, numeric, text, text);
create or replace function online_submit_action(
  p_hand_id uuid,
  p_actor_group_player_id uuid,
  p_action_type text,
  p_amount numeric default null,
  p_client_action_id text default null,
  p_seat_token text default null
)
returns online_actions
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_table online_tables%rowtype;
  v_hand_player online_hand_players%rowtype;
  v_action online_actions%rowtype;
  v_existing online_actions%rowtype;
  v_to_call numeric := 0;
  v_stack numeric := 0;
  v_add numeric := 0;
  v_raise_to numeric := 0;
  v_prev_bet numeric := 0;
  v_new_street_contribution numeric := 0;
  v_is_full_raise boolean := false;
  v_live_players int := 0;
  v_next_actor int;
  v_round_done boolean := false;
  v_next_state text;
  v_board jsonb;
  v_deck text[];
  v_deal_count int := 0;
  v_burn_card text;
  v_winner_seat int;
  v_active_seat online_table_seats%rowtype;
  v_action_street text;
  v_record_vpip boolean := false;
  v_record_pfr boolean := false;
  v_other_raise_eligible_players int := 0;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
  end if;
  if v_hand.state not in ('preflop', 'flop', 'turn', 'river') then
    raise exception 'hand_not_accepting_actions';
  end if;

  select * into v_table
  from online_tables
  where id = v_hand.table_id;

  if p_client_action_id is not null then
    select * into v_existing
    from online_actions
    where hand_id = p_hand_id
      and actor_group_player_id = p_actor_group_player_id
      and client_action_id = p_client_action_id
    order by created_at desc
    limit 1;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_hand_player
  from online_hand_players
  where hand_id = p_hand_id
    and group_player_id = p_actor_group_player_id
  for update;

  if not found then
    raise exception 'actor_not_in_hand';
  end if;

  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select *
  into v_active_seat
  from online_table_seats
  where table_id = v_hand.table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
  limit 1;

  if not found then
    raise exception 'actor_not_seated';
  end if;

  if v_active_seat.seat_token <> p_seat_token then
    raise exception 'seat_token_invalid';
  end if;

  if v_hand.action_seat is null or v_hand_player.seat_no <> v_hand.action_seat then
    raise exception 'not_actor_turn';
  end if;
  if v_hand_player.folded then
    raise exception 'actor_already_folded';
  end if;
  if v_hand_player.all_in or coalesce(v_hand_player.stack_end, 0) <= 0 then
    raise exception 'actor_already_all_in';
  end if;

  v_prev_bet := coalesce(v_hand.current_bet, 0);
  v_action_street := v_hand.state;
  v_to_call := greatest(v_prev_bet - coalesce(v_hand_player.street_contribution, 0), 0);
  v_stack := greatest(coalesce(v_hand_player.stack_end, 0), 0);
  select count(*)
  into v_other_raise_eligible_players
  from online_hand_players
  where hand_id = p_hand_id
    and seat_no <> v_hand_player.seat_no
    and not folded
    and not all_in
    and (coalesce(stack_end, 0) + coalesce(street_contribution, 0)) > v_prev_bet;

  if p_action_type not in ('fold', 'check', 'call', 'bet', 'raise', 'all_in') then
    raise exception 'invalid_action_type';
  end if;

  if v_other_raise_eligible_players = 0
     and p_action_type in ('bet', 'raise', 'all_in') then
    if p_action_type in ('bet', 'raise') then
      raise exception 'no_opponents_left_to_raise';
    end if;
    if coalesce(v_hand_player.street_contribution, 0) + v_stack > v_prev_bet then
      raise exception 'no_opponents_left_to_raise';
    end if;
  end if;

  if p_action_type = 'check' and v_to_call > 0 then
    raise exception 'cannot_check';
  end if;

  if p_action_type = 'call' then
    if v_to_call <= 0 then
      raise exception 'nothing_to_call';
    end if;
    v_add := least(v_to_call, v_stack);
  elsif p_action_type = 'bet' then
    if v_prev_bet > 0 then
      raise exception 'use_raise_not_bet';
    end if;
    if p_amount is null or p_amount <= 0 then
      raise exception 'positive_amount_required';
    end if;
    v_add := least(p_amount, v_stack);
    if v_add < coalesce(v_table.big_blind, 1) and v_add < v_stack then
      raise exception 'bet_below_big_blind';
    end if;
  elsif p_action_type = 'raise' then
    if v_prev_bet <= 0 then
      raise exception 'use_bet_not_raise';
    end if;
    if p_amount is null or p_amount <= v_prev_bet then
      raise exception 'raise_target_too_low';
    end if;
    v_raise_to := p_amount;
    if v_raise_to > coalesce(v_hand_player.street_contribution, 0) + v_stack then
      raise exception 'raise_exceeds_stack';
    end if;
    v_add := v_raise_to - coalesce(v_hand_player.street_contribution, 0);
    if v_add <= 0 then
      raise exception 'raise_add_invalid';
    end if;
    v_is_full_raise := (v_raise_to - v_prev_bet) >= greatest(coalesce(v_hand.min_raise, 0), coalesce(v_table.big_blind, 1));
    if not v_is_full_raise and v_add < v_stack then
      raise exception 'raise_below_min';
    end if;
  elsif p_action_type = 'all_in' then
    v_add := v_stack;
    if v_add <= 0 then
      raise exception 'no_stack';
    end if;
    if v_prev_bet > 0 then
      v_raise_to := coalesce(v_hand_player.street_contribution, 0) + v_add;
      v_is_full_raise := (v_raise_to - v_prev_bet) >= greatest(coalesce(v_hand.min_raise, 0), coalesce(v_table.big_blind, 1));
    end if;
  else
    v_add := 0;
  end if;

  if p_action_type = 'fold' then
    update online_hand_players
    set
      folded = true,
      has_acted = true
    where id = v_hand_player.id
    returning * into v_hand_player;
  else
    update online_hand_players
    set
      street_contribution = coalesce(street_contribution, 0) + v_add,
      committed = coalesce(committed, 0) + v_add,
      stack_end = greatest(0, coalesce(stack_end, 0) - v_add),
      all_in = greatest(0, coalesce(stack_end, 0) - v_add) = 0,
      has_acted = true
    where id = v_hand_player.id
    returning * into v_hand_player;

    if v_add > 0 then
      update online_hands
      set pot_total = coalesce(pot_total, 0) + v_add
      where id = p_hand_id
      returning * into v_hand;
    end if;
  end if;

  v_new_street_contribution := coalesce(v_hand_player.street_contribution, 0);
  v_record_vpip := v_action_street = 'preflop'
    and p_action_type in ('call', 'raise', 'all_in')
    and not coalesce(v_hand_player.stat_vpip_recorded, false);
  v_record_pfr := v_action_street = 'preflop'
    and p_action_type in ('raise', 'all_in')
    and not coalesce(v_hand_player.stat_pfr_recorded, false);

  if v_record_vpip or v_record_pfr then
    update online_hand_players
    set
      stat_vpip_recorded = stat_vpip_recorded or v_record_vpip,
      stat_pfr_recorded = stat_pfr_recorded or v_record_pfr
    where id = v_hand_player.id
    returning * into v_hand_player;
  end if;

  perform online_bot_profile_record_action(
    v_hand.table_id,
    p_actor_group_player_id,
    v_action_street,
    p_action_type,
    v_to_call > 0,
    v_record_vpip,
    v_record_pfr
  );

  if p_action_type in ('bet', 'raise', 'all_in') and v_new_street_contribution > v_prev_bet then
    if p_action_type = 'bet' then
        update online_hands
        set
          current_bet = v_new_street_contribution,
          min_raise = greatest(coalesce(v_table.big_blind, 1), v_new_street_contribution),
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;
    elsif v_is_full_raise then
        update online_hands
        set
          current_bet = v_new_street_contribution,
          min_raise = greatest(coalesce(v_table.big_blind, 1), v_new_street_contribution - v_prev_bet),
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;
    else
        update online_hands
        set
          current_bet = greatest(current_bet, v_new_street_contribution),
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;
    end if;

    update online_hand_players
    set has_acted = false
    where hand_id = p_hand_id
      and seat_no <> v_hand_player.seat_no
      and not folded
      and not all_in
      and coalesce(stack_end, 0) > 0;
  end if;

  select count(*)
  into v_live_players
  from online_hand_players
  where hand_id = p_hand_id
    and not folded;

  if v_live_players <= 1 then
    select seat_no
    into v_winner_seat
    from online_hand_players
    where hand_id = p_hand_id
      and not folded
    limit 1;

    update online_hand_players
    set result_amount = case when seat_no = v_winner_seat then coalesce(v_hand.pot_total, 0) else 0 end
    where hand_id = p_hand_id;

    update online_hand_players
    set stack_end = coalesce(stack_end, 0) + coalesce(v_hand.pot_total, 0)
    where hand_id = p_hand_id
      and seat_no = v_winner_seat;

    update online_table_seats s
    set chip_stack = hp.stack_end
    from online_hand_players hp
    where hp.hand_id = p_hand_id
      and s.table_id = v_hand.table_id
      and s.seat_no = hp.seat_no
      and s.group_player_id = hp.group_player_id
      and s.left_at is null;

    update online_hands
    set
      state = 'settled',
      action_seat = null,
      ended_at = now(),
      last_action_at = now(),
      turn_grace_used_secs = 0
    where id = p_hand_id
    returning * into v_hand;

    perform online_append_hand_event(
      p_hand_id,
      v_hand.table_id,
      'pot_awarded',
      p_actor_group_player_id,
      jsonb_build_object('winner_seat', v_winner_seat, 'amount', v_hand.pot_total)
    );

    perform online_append_hand_event(
      p_hand_id,
      v_hand.table_id,
      'hand_settled',
      p_actor_group_player_id,
      jsonb_build_object('reason', 'everyone_else_folded')
    );

    perform online_bot_profile_record_hand_completion(
      p_hand_id,
      false
    );
  else
    v_round_done := online_betting_round_complete(p_hand_id);

    if v_round_done then
      if v_hand.state = 'river' then
        update online_hands
        set
          state = 'showdown',
          action_seat = null,
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;

        perform online_append_hand_event(
          p_hand_id,
          v_hand.table_id,
          'showdown_ready',
          p_actor_group_player_id,
          jsonb_build_object('reason', 'river_round_complete')
        );
      else
        v_next_state := case v_hand.state
          when 'preflop' then 'flop'
          when 'flop' then 'turn'
          when 'turn' then 'river'
          else v_hand.state
        end;

        v_deal_count := case v_next_state
          when 'flop' then 3
          when 'turn' then 1
          when 'river' then 1
          else 0
        end;

        v_board := coalesce(v_hand.board_cards, '[]'::jsonb);
        v_deck := array(
          select jsonb_array_elements_text(coalesce(v_hand.deck_cards, '[]'::jsonb))
        );

        -- Real table dealing: burn one card before every board reveal.
        if coalesce(array_length(v_deck, 1), 0) < (v_deal_count + 1) then
          raise exception 'deck_exhausted';
        end if;

        if v_deal_count > 0 then
          v_burn_card := v_deck[1];
          if v_deal_count = 3 then
            v_board := v_board || jsonb_build_array(v_deck[2], v_deck[3], v_deck[4]);
            v_deck := coalesce(v_deck[5:array_length(v_deck, 1)], array[]::text[]);
          else
            v_board := v_board || jsonb_build_array(v_deck[2]);
            v_deck := coalesce(v_deck[3:array_length(v_deck, 1)], array[]::text[]);
          end if;
        end if;

        update online_hand_players
        set
          street_contribution = 0,
          has_acted = false
        where hand_id = p_hand_id
          and not folded;

        v_next_actor := online_first_postflop_action_seat(p_hand_id, v_hand.button_seat);

        update online_hands
        set
          state = v_next_state,
          board_cards = v_board,
          deck_cards = to_jsonb(v_deck),
          current_bet = 0,
          min_raise = greatest(coalesce(v_table.big_blind, 1), 1),
          action_seat = v_next_actor,
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;

        perform online_append_hand_event(
          p_hand_id,
          v_hand.table_id,
          'street_dealt',
          p_actor_group_player_id,
          jsonb_build_object(
            'street', v_next_state,
            'board_cards', v_board,
            'burned', v_burn_card is not null
          )
        );
      end if;
    else
      v_next_actor := online_next_action_seat(p_hand_id, v_hand_player.seat_no);
      update online_hands
      set
        action_seat = v_next_actor,
        last_action_at = now(),
        turn_grace_used_secs = 0
      where id = p_hand_id
      returning * into v_hand;
    end if;
  end if;

  insert into online_actions(
    hand_id,
    table_id,
    actor_group_player_id,
    client_action_id,
    action_type,
    amount,
    status
  )
  values (
    p_hand_id,
    v_hand.table_id,
    p_actor_group_player_id,
    p_client_action_id,
    p_action_type,
    case when p_action_type in ('call','bet','raise','all_in') then v_add else null end,
    'accepted'
  )
  returning * into v_action;

  perform online_append_hand_event(
    p_hand_id,
    v_hand.table_id,
    'action_taken',
    p_actor_group_player_id,
    jsonb_build_object(
      'action_type', p_action_type,
      'amount', case when p_action_type in ('call','bet','raise','all_in') then v_add else null end,
      'to_call_before', v_to_call,
      'seat_no', v_hand_player.seat_no,
      'street', v_action_street
    )
  );

  perform online_write_hand_snapshot(p_hand_id);
  return v_action;
end;
$$;
