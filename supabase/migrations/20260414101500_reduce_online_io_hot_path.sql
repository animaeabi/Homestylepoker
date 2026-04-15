-- Reduce online poker Disk IO on the hot path:
-- 1) add missing indexes for latest-hand/runtime/rate-limit lookups
-- 2) make event/snapshot seq lookups index-friendly
-- 3) stop snapshotting on every accepted action
-- 4) remove continuation_attempted event writes from online_continue_hand

create index if not exists idx_online_hands_table_hand_no_desc
  on online_hands(table_id, hand_no desc);

create index if not exists idx_online_hands_active_last_action
  on online_hands(last_action_at, table_id)
  where state in ('preflop', 'flop', 'turn', 'river', 'showdown');

create index if not exists idx_online_hand_players_hand_group_player
  on online_hand_players(hand_id, group_player_id);

create index if not exists idx_online_actions_hand_actor_created_desc
  on online_actions(hand_id, actor_group_player_id, created_at desc)
  where status = 'accepted';

create or replace function online_append_hand_event(
  p_hand_id uuid,
  p_table_id uuid,
  p_event_type text,
  p_actor_group_player_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
as $$
declare
  v_seq bigint;
begin
  perform 1 from online_hands where id = p_hand_id for update;
  select coalesce((
    select ev.seq
    from online_hand_events ev
    where ev.hand_id = p_hand_id
    order by ev.seq desc
    limit 1
  ), 0) + 1
  into v_seq;

  insert into online_hand_events(
    hand_id,
    table_id,
    seq,
    event_type,
    actor_group_player_id,
    payload
  )
  values (
    p_hand_id,
    p_table_id,
    v_seq,
    p_event_type,
    p_actor_group_player_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  return v_seq;
end;
$$;

create or replace function online_write_hand_snapshot(p_hand_id uuid)
returns void
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_seq bigint;
  v_players jsonb;
  v_state jsonb;
begin
  select * into v_hand from online_hands where id = p_hand_id;
  if not found then
    raise exception 'online_hand_not_found';
  end if;

  select coalesce((
    select ev.seq
    from online_hand_events ev
    where ev.hand_id = p_hand_id
    order by ev.seq desc
    limit 1
  ), 0)
  into v_seq;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seat_no', seat_no,
        'group_player_id', group_player_id,
        'stack_start', stack_start,
        'stack_end', stack_end,
        'committed', committed,
        'folded', folded,
        'all_in', all_in,
        'result_amount', result_amount
      )
      order by seat_no
    ),
    '[]'::jsonb
  )
  into v_players
  from online_hand_players
  where hand_id = p_hand_id;

  v_state := jsonb_build_object(
    'hand_id', v_hand.id,
    'table_id', v_hand.table_id,
    'hand_no', v_hand.hand_no,
    'state', v_hand.state,
    'button_seat', v_hand.button_seat,
    'small_blind_seat', v_hand.small_blind_seat,
    'big_blind_seat', v_hand.big_blind_seat,
    'board_cards', coalesce(v_hand.board_cards, '[]'::jsonb),
    'pot_total', v_hand.pot_total,
    'players', v_players
  );

  insert into online_hand_snapshots(hand_id, table_id, seq, state)
  values (v_hand.id, v_hand.table_id, v_seq, v_state)
  on conflict (hand_id, seq)
  do update set
    state = excluded.state,
    created_at = now();
end;
$$;

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
  v_current_contribution numeric := 0;
  v_new_street_contribution numeric := 0;
  v_is_full_raise boolean := false;
  v_live_players int := 0;
  v_next_actor int;
  v_round_done boolean := false;
  v_next_state text;
  v_board jsonb;
  v_deck_json jsonb;
  v_deck text[];
  v_deck_payload jsonb;
  v_deal_count int := 0;
  v_burn_card text;
  v_winner_seat int;
  v_active_seat online_table_seats%rowtype;
  v_action_street text;
  v_record_vpip boolean := false;
  v_record_pfr boolean := false;
  v_other_raise_eligible_players int := 0;
  v_should_snapshot boolean := false;
begin
  perform online_check_action_rate_limit(p_hand_id, p_actor_group_player_id);

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
  if v_hand_player.all_in or online_normalize_money(coalesce(v_hand_player.stack_end, 0)) <= 0 then
    raise exception 'actor_already_all_in';
  end if;

  v_prev_bet := online_normalize_money(coalesce(v_hand.current_bet, 0));
  v_action_street := v_hand.state;
  v_current_contribution := online_normalize_money(coalesce(v_hand_player.street_contribution, 0));
  v_to_call := online_normalize_money(greatest(v_prev_bet - v_current_contribution, 0));
  v_stack := online_normalize_money(greatest(coalesce(v_hand_player.stack_end, 0), 0));
  select count(*)
  into v_other_raise_eligible_players
  from online_hand_players
  where hand_id = p_hand_id
    and seat_no <> v_hand_player.seat_no
    and not folded
    and not all_in
    and online_normalize_money(coalesce(stack_end, 0) + coalesce(street_contribution, 0)) > v_prev_bet;

  if p_action_type not in ('fold', 'check', 'call', 'bet', 'raise', 'all_in') then
    raise exception 'invalid_action_type';
  end if;

  if v_other_raise_eligible_players = 0
     and p_action_type in ('bet', 'raise', 'all_in') then
    if p_action_type in ('bet', 'raise') then
      raise exception 'no_opponents_left_to_raise';
    end if;
    if online_normalize_money(v_current_contribution + v_stack) > v_prev_bet then
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
    v_add := online_normalize_money(least(v_to_call, v_stack));
  elsif p_action_type = 'bet' then
    if v_prev_bet > 0 then
      raise exception 'use_raise_not_bet';
    end if;
    p_amount := online_normalize_money(p_amount);
    if p_amount is null or p_amount <= 0 then
      raise exception 'positive_amount_required';
    end if;
    v_add := online_normalize_money(least(p_amount, v_stack));
    if v_add < coalesce(v_table.big_blind, 1) and v_add < v_stack then
      raise exception 'bet_below_big_blind';
    end if;
  elsif p_action_type = 'raise' then
    if v_prev_bet <= 0 then
      raise exception 'use_bet_not_raise';
    end if;
    p_amount := online_normalize_money(p_amount);
    if p_amount is null or p_amount <= v_prev_bet then
      raise exception 'raise_target_too_low';
    end if;
    v_raise_to := p_amount;
    if v_raise_to > online_normalize_money(v_current_contribution + v_stack) then
      raise exception 'raise_exceeds_stack';
    end if;
    v_add := online_normalize_money(v_raise_to - v_current_contribution);
    if v_add <= 0 then
      raise exception 'raise_add_invalid';
    end if;
    v_is_full_raise := online_normalize_money(v_raise_to - v_prev_bet) >= greatest(coalesce(v_hand.min_raise, 0), coalesce(v_table.big_blind, 1));
    if not v_is_full_raise and v_add < v_stack then
      raise exception 'raise_below_min';
    end if;
  elsif p_action_type = 'all_in' then
    v_add := online_normalize_money(v_stack);
    if v_add <= 0 then
      raise exception 'no_stack';
    end if;
    if v_prev_bet > 0 then
      v_raise_to := online_normalize_money(v_current_contribution + v_add);
      v_is_full_raise := online_normalize_money(v_raise_to - v_prev_bet) >= greatest(coalesce(v_hand.min_raise, 0), coalesce(v_table.big_blind, 1));
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
      street_contribution = online_normalize_money(coalesce(street_contribution, 0) + v_add),
      committed = online_normalize_money(coalesce(committed, 0) + v_add),
      stack_end = online_normalize_money(greatest(0, coalesce(stack_end, 0) - v_add)),
      all_in = online_normalize_money(greatest(0, coalesce(stack_end, 0) - v_add)) = 0,
      has_acted = true
    where id = v_hand_player.id
    returning * into v_hand_player;

    if v_add > 0 then
      update online_hands
      set pot_total = online_normalize_money(coalesce(pot_total, 0) + v_add)
      where id = p_hand_id
      returning * into v_hand;
    end if;
  end if;

  v_new_street_contribution := online_normalize_money(coalesce(v_hand_player.street_contribution, 0));
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
          current_bet = online_normalize_money(v_new_street_contribution),
          min_raise = online_normalize_money(greatest(coalesce(v_table.big_blind, 1), v_new_street_contribution)),
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;
    elsif v_is_full_raise then
        update online_hands
        set
          current_bet = online_normalize_money(v_new_street_contribution),
          min_raise = online_normalize_money(greatest(coalesce(v_table.big_blind, 1), v_new_street_contribution - v_prev_bet)),
          last_action_at = now(),
          turn_grace_used_secs = 0
        where id = p_hand_id
        returning * into v_hand;
    else
        update online_hands
        set
          current_bet = online_normalize_money(greatest(current_bet, v_new_street_contribution)),
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
      and online_normalize_money(coalesce(stack_end, 0)) > 0;
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
    set
      result_amount = case when seat_no = v_winner_seat then online_normalize_money(coalesce(v_hand.pot_total, 0)) else 0 end,
      stack_end = online_normalize_money(coalesce(stack_end, 0)),
      committed = online_normalize_money(coalesce(committed, 0)),
      street_contribution = online_normalize_money(coalesce(street_contribution, 0))
    where hand_id = p_hand_id;

    update online_hand_players
    set stack_end = online_normalize_money(coalesce(stack_end, 0) + coalesce(v_hand.pot_total, 0))
    where hand_id = p_hand_id
      and seat_no = v_winner_seat;

    update online_table_seats s
    set chip_stack = online_normalize_money(hp.stack_end)
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
      jsonb_build_object('winner_seat', v_winner_seat, 'amount', online_normalize_money(v_hand.pot_total))
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
    v_should_snapshot := true;
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
        v_should_snapshot := true;
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
        v_deck_json := online_private.unpack_remaining_deck(v_hand.deck_cards, v_hand.deck_cards_encrypted);
        v_deck := array(
          select jsonb_array_elements_text(coalesce(v_deck_json, '[]'::jsonb))
        );

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
        v_deck_payload := online_private.pack_remaining_deck(to_jsonb(v_deck));

        update online_hands
        set
          state = v_next_state,
          board_cards = v_board,
          deck_cards = coalesce(v_deck_payload->'deck_cards', '[]'::jsonb),
          deck_cards_encrypted = nullif(v_deck_payload->>'deck_cards_encrypted', ''),
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
        v_should_snapshot := true;
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

  if v_should_snapshot then
    perform online_write_hand_snapshot(p_hand_id);
  end if;
  return v_action;
end;
$$;

drop function if exists online_continue_hand(uuid, uuid, text);
create or replace function online_continue_hand(
  p_hand_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_table_id uuid;
  v_seat_row online_table_seats%rowtype;
  v_cont jsonb;
  v_advance_count int := 0;
  v_max_advances int := 5;
  v_triggered_runtime boolean := false;
  v_request_id bigint;
  v_anon_key text;
  v_dispatch_secret text;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  v_table_id := v_hand.table_id;

  select * into v_seat_row
  from online_table_seats
  where table_id = v_table_id
    and group_player_id = p_actor_group_player_id
    and seat_token = p_seat_token
    and left_at is null;

  if not found then
    raise exception 'online_continue_hand_not_seated';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('online_continue_hand'), hashtext(v_table_id::text)) then
    return jsonb_build_object(
      'continued', false,
      'triggered_runtime', false,
      'final_state', v_hand.state,
      'reason', 'rate_limited'
    );
  end if;

  v_cont := online_post_action_continuation(p_hand_id);

  if v_hand.state in ('settled', 'canceled') then
    return jsonb_build_object(
      'continued', false,
      'triggered_runtime', false,
      'final_state', v_hand.state,
      'reason', 'hand_complete'
    );
  end if;

  if (v_cont->>'needs_allin_runout')::boolean then
    while v_advance_count < v_max_advances loop
      select * into v_hand
      from online_hands
      where id = p_hand_id;

      if v_hand.state not in ('preflop','flop','turn','river') then
        exit;
      end if;

      if exists(
        select 1 from online_hand_players hp
        where hp.hand_id = p_hand_id
          and not hp.folded
          and not hp.all_in
          and hp.stack_end is not null
          and online_normalize_money(hp.stack_end) > 0
      ) then
        exit;
      end if;

      perform online_advance_hand(p_hand_id, p_actor_group_player_id, 'allin_runout');
      v_advance_count := v_advance_count + 1;
    end loop;

    select * into v_hand from online_hands where id = p_hand_id;
    v_cont := online_post_action_continuation(p_hand_id);
  end if;

  if (v_cont->>'needs_showdown')::boolean or (v_cont->>'next_actor_is_bot')::boolean then
    v_anon_key := online_private.get_supabase_anon_key();
    v_dispatch_secret := online_private.get_runtime_dispatch_secret();

    if coalesce(v_anon_key, '') <> '' and coalesce(v_dispatch_secret, '') <> '' then
      select net.http_post(
        url := 'https://xngwmtwrruvbrlxhekxp.supabase.co/functions/v1/online-runtime-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key,
          'apikey', v_anon_key,
          'x-online-runtime-secret', v_dispatch_secret
        ),
        body := jsonb_build_object(
          'mode', 'nudge',
          'hand_id', p_hand_id::text,
          'table_id', v_table_id::text,
          'actor_group_player_id', p_actor_group_player_id::text,
          'settle_note', 'continuation_settle'
        )
      )
      into v_request_id;
      v_triggered_runtime := true;
    end if;
  end if;

  select * into v_hand from online_hands where id = p_hand_id;

  return jsonb_build_object(
    'continued', v_advance_count > 0 or v_triggered_runtime,
    'triggered_runtime', v_triggered_runtime,
    'final_state', v_hand.state,
    'advances', v_advance_count,
    'reason', case
      when v_triggered_runtime and (v_cont->>'needs_showdown')::boolean then 'showdown_nudged'
      when v_triggered_runtime and (v_cont->>'next_actor_is_bot')::boolean then 'bot_nudged'
      when v_advance_count > 0 then 'allin_runout_advanced'
      else 'no_continuation_needed'
    end
  );
end;
$$;
