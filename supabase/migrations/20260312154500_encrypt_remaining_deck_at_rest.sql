create schema if not exists online_private;

alter table online_hands
  add column if not exists deck_cards_encrypted text;

drop function if exists online_private.get_deck_crypto_key();
create or replace function online_private.get_deck_crypto_key()
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'online_deck_crypto_key'
      order by created_at desc
      limit 1
    $vault$
    into v_key;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') = '' then
    v_key := nullif(current_setting('app.settings.online_deck_crypto_key', true), '');
  end if;

  return v_key;
end;
$$;

drop function if exists online_private.pack_remaining_deck(jsonb);
create or replace function online_private.pack_remaining_deck(p_deck jsonb)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_payload jsonb := coalesce(p_deck, '[]'::jsonb);
begin
  v_key := online_private.get_deck_crypto_key();
  if coalesce(v_key, '') = '' then
    return jsonb_build_object(
      'deck_cards', v_payload,
      'deck_cards_encrypted', null
    );
  end if;

  return jsonb_build_object(
    'deck_cards', '[]'::jsonb,
    'deck_cards_encrypted', encode(
      pgp_sym_encrypt(v_payload::text, v_key, 'cipher-algo=aes256,compress-algo=0'),
      'base64'
    )
  );
end;
$$;

drop function if exists online_private.unpack_remaining_deck(jsonb, text);
create or replace function online_private.unpack_remaining_deck(
  p_deck_cards jsonb,
  p_deck_cards_encrypted text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_plain text;
begin
  if coalesce(nullif(trim(p_deck_cards_encrypted), ''), '') = '' then
    return coalesce(p_deck_cards, '[]'::jsonb);
  end if;

  v_key := online_private.get_deck_crypto_key();
  if coalesce(v_key, '') = '' then
    raise exception 'online_deck_crypto_key_not_configured';
  end if;

  v_plain := pgp_sym_decrypt(decode(p_deck_cards_encrypted, 'base64'), v_key);
  return coalesce(v_plain::jsonb, '[]'::jsonb);
end;
$$;

grant usage on schema online_private to anon, authenticated, service_role;
grant execute on function online_private.get_deck_crypto_key() to anon, authenticated, service_role;
grant execute on function online_private.pack_remaining_deck(jsonb) to anon, authenticated, service_role;
grant execute on function online_private.unpack_remaining_deck(jsonb, text) to anon, authenticated, service_role;

drop function if exists online_get_hand_state_viewer(uuid, uuid, text, bigint);
create or replace function online_get_hand_state_viewer(
  p_hand_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_hand_row online_hands%rowtype;
  v_hand jsonb;
  v_snapshot jsonb;
  v_players jsonb;
  v_events jsonb;
  v_viewer_seat_no int;
  v_reveal_all boolean := false;
begin
  select * into v_hand_row
  from online_hands h
  where h.id = p_hand_id;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  v_hand := to_jsonb(v_hand_row) - 'deck_cards' - 'deck_cards_encrypted';
  v_reveal_all := v_hand_row.state in ('showdown', 'settled');

  if p_viewer_group_player_id is not null
     and coalesce(nullif(trim(p_viewer_seat_token), ''), '') <> ''
  then
    select s.seat_no
    into v_viewer_seat_no
    from online_table_seats s
    where s.table_id = v_hand_row.table_id
      and s.group_player_id = p_viewer_group_player_id
      and s.left_at is null
      and s.seat_token = p_viewer_seat_token
    limit 1;
  end if;

  select state into v_snapshot
  from online_hand_snapshots
  where hand_id = p_hand_id
  order by seq desc
  limit 1;

  select coalesce(
    jsonb_agg(
      case
        when v_reveal_all then to_jsonb(hp)
        when hp.seat_no = v_viewer_seat_no then to_jsonb(hp)
        else to_jsonb(hp) - 'hole_cards'
      end
      order by hp.seat_no
    ),
    '[]'::jsonb
  )
  into v_players
  from online_hand_players hp
  where hp.hand_id = p_hand_id;

  select coalesce(jsonb_agg(to_jsonb(ev) order by ev.seq), '[]'::jsonb)
  into v_events
  from online_hand_events ev
  where ev.hand_id = p_hand_id
    and (p_since_seq is null or ev.seq > p_since_seq);

  return jsonb_build_object(
    'hand', v_hand,
    'snapshot', coalesce(v_snapshot, '{}'::jsonb),
    'players', v_players,
    'events', v_events
  );
end;
$$;

create or replace function online_start_hand(
  p_table_id uuid,
  p_started_by_group_player_id uuid default null,
  p_host_seat_token text default null
)
returns online_hands
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_host_seat online_table_seats%rowtype;
  v_active_hand_id uuid;
  v_hand online_hands%rowtype;
  v_hand_no bigint;
  v_active_seats int[];
  v_last_button_seat int;
  v_button_seat int;
  v_small_blind_seat int;
  v_big_blind_seat int;
  v_action_seat int;
  v_shuffle jsonb;
  v_deck text[];
  v_deck_commitment text;
  v_rng_seed_hash text;
  v_remaining text[];
  v_deck_payload jsonb;
  v_cursor int := 1;
  v_sb_post numeric := 0;
  v_bb_post numeric := 0;
  v_pot_total numeric := 0;
  v_seat record;
  v_round int;
  v_seat_no int;
begin
  select * into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;
  if v_table.status = 'closed' then
    raise exception 'online_table_closed';
  end if;

  if online_active_human_host_group_player(p_table_id) is null then
    if p_started_by_group_player_id is null then
      raise exception 'host_identity_required';
    end if;

    perform 1
    from group_players gp
    where gp.id = p_started_by_group_player_id
      and gp.group_id = v_table.group_id
      and gp.archived_at is null;
    if not found then
      raise exception 'starter_not_in_group';
    end if;

    perform online_prune_bot_seats(p_table_id);

    update online_tables
    set created_by_group_player_id = online_first_active_human_group_player(p_table_id)
    where id = p_table_id
      and online_active_human_host_group_player(p_table_id) is null;

    select * into v_table
    from online_tables
    where id = p_table_id
    for update;
  end if;

  if p_started_by_group_player_id is null
     or p_started_by_group_player_id <> v_table.created_by_group_player_id
  then
    raise exception 'host_required_to_start_hand';
  end if;

  if coalesce(nullif(trim(p_host_seat_token), ''), '') = '' then
    raise exception 'host_seat_token_required';
  end if;

  select *
  into v_host_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = v_table.created_by_group_player_id
    and left_at is null
  limit 1;

  if not found then
    raise exception 'host_not_seated';
  end if;

  if v_host_seat.seat_token is distinct from p_host_seat_token then
    raise exception 'host_seat_token_invalid';
  end if;

  select id
  into v_active_hand_id
  from online_hands
  where table_id = p_table_id
    and state not in ('settled', 'canceled')
  order by hand_no desc
  limit 1
  for update;

  if v_active_hand_id is not null then
    raise exception 'online_hand_already_active';
  end if;

  select array_agg(seat_no order by seat_no)
  into v_active_seats
  from online_table_seats
  where table_id = p_table_id
    and group_player_id is not null
    and left_at is null
    and not is_sitting_out
    and coalesce(chip_stack, 0) > 0;

  if coalesce(array_length(v_active_seats, 1), 0) < 2 then
    raise exception 'not_enough_active_players';
  end if;

  select button_seat
  into v_last_button_seat
  from online_hands
  where table_id = p_table_id
  order by hand_no desc
  limit 1;

  v_button_seat := online_next_active_seat(v_active_seats, v_last_button_seat);
  if array_length(v_active_seats, 1) = 2 then
    v_small_blind_seat := v_button_seat;
    v_big_blind_seat := online_next_active_seat(v_active_seats, v_button_seat);
  else
    v_small_blind_seat := online_next_active_seat(v_active_seats, v_button_seat);
    v_big_blind_seat := online_next_active_seat(v_active_seats, v_small_blind_seat);
  end if;

  select coalesce(max(hand_no), 0) + 1
  into v_hand_no
  from online_hands
  where table_id = p_table_id;

  v_shuffle := online_secure_shuffle_bundle();
  v_deck := array(
    select jsonb_array_elements_text(coalesce(v_shuffle->'deck', '[]'::jsonb))
  );
  v_deck_commitment := nullif(v_shuffle->>'deck_commitment', '');
  v_rng_seed_hash := nullif(v_shuffle->>'rng_seed_hash', '');

  insert into online_hands(
    table_id,
    hand_no,
    state,
    button_seat,
    small_blind_seat,
    big_blind_seat,
    board_cards,
    pot_total,
    deck_commitment,
    rng_seed_hash,
    deck_cards,
    deck_cards_encrypted,
    current_bet,
    min_raise,
    action_seat,
    last_action_at
  )
  values (
    p_table_id,
    v_hand_no,
    'preflop',
    v_button_seat,
    v_small_blind_seat,
    v_big_blind_seat,
    '[]'::jsonb,
    0,
    v_deck_commitment,
    v_rng_seed_hash,
    '[]'::jsonb,
    null,
    0,
    v_table.big_blind,
    null,
    now()
  )
  returning * into v_hand;

  for v_seat in
    select seat_no, group_player_id, chip_stack
    from online_table_seats
    where table_id = p_table_id
      and group_player_id is not null
      and left_at is null
      and not is_sitting_out
      and coalesce(chip_stack, 0) > 0
    order by seat_no
  loop
    insert into online_hand_players(
      hand_id,
      seat_no,
      group_player_id,
      stack_start,
      stack_end,
      committed,
      street_contribution,
      folded,
      all_in,
      has_acted,
      hole_cards
    )
    values (
      v_hand.id,
      v_seat.seat_no,
      v_seat.group_player_id,
      online_normalize_money(v_seat.chip_stack),
      online_normalize_money(v_seat.chip_stack),
      0,
      0,
      false,
      false,
      false,
      '[]'::jsonb
    );

    perform online_bot_profile_record_hand_start(
      p_table_id,
      v_seat.group_player_id
    );
  end loop;

  for v_round in 1..2 loop
    foreach v_seat_no in array v_active_seats loop
      update online_hand_players
      set hole_cards = coalesce(hole_cards, '[]'::jsonb) || to_jsonb(v_deck[v_cursor])
      where hand_id = v_hand.id
        and seat_no = v_seat_no;
      v_cursor := v_cursor + 1;
    end loop;
  end loop;

  update online_hand_players
  set
    street_contribution = online_normalize_money(least(coalesce(stack_end, 0), v_table.small_blind)),
    committed = online_normalize_money(least(coalesce(stack_end, 0), v_table.small_blind)),
    stack_end = online_normalize_money(greatest(0, coalesce(stack_end, 0) - v_table.small_blind)),
    all_in = online_normalize_money(greatest(0, coalesce(stack_end, 0) - v_table.small_blind)) = 0
  where hand_id = v_hand.id
    and seat_no = v_small_blind_seat
  returning street_contribution into v_sb_post;

  update online_hand_players
  set
    street_contribution = online_normalize_money(least(coalesce(stack_end, 0), v_table.big_blind)),
    committed = online_normalize_money(least(coalesce(stack_end, 0), v_table.big_blind)),
    stack_end = online_normalize_money(greatest(0, coalesce(stack_end, 0) - v_table.big_blind)),
    all_in = online_normalize_money(greatest(0, coalesce(stack_end, 0) - v_table.big_blind)) = 0
  where hand_id = v_hand.id
    and seat_no = v_big_blind_seat
  returning street_contribution into v_bb_post;

  v_sb_post := online_normalize_money(coalesce(v_sb_post, 0));
  v_bb_post := online_normalize_money(coalesce(v_bb_post, 0));
  v_pot_total := online_normalize_money(v_sb_post + v_bb_post);
  v_action_seat := online_next_action_seat(v_hand.id, v_big_blind_seat);
  v_remaining := coalesce(v_deck[v_cursor:array_length(v_deck, 1)], array[]::text[]);
  v_deck_payload := online_private.pack_remaining_deck(to_jsonb(v_remaining));

  update online_hands
  set
    pot_total = online_normalize_money(v_pot_total),
    current_bet = online_normalize_money(greatest(v_sb_post, v_bb_post)),
    min_raise = greatest(1, coalesce(v_table.big_blind, 1)),
    action_seat = v_action_seat,
    deck_cards = coalesce(v_deck_payload->'deck_cards', '[]'::jsonb),
    deck_cards_encrypted = nullif(v_deck_payload->>'deck_cards_encrypted', ''),
    state = case when v_action_seat is null then 'showdown' else 'preflop' end
  where id = v_hand.id
  returning * into v_hand;

  perform online_append_hand_event(
    v_hand.id,
    p_table_id,
    'hand_started',
    p_started_by_group_player_id,
    jsonb_build_object(
      'hand_no', v_hand_no,
      'button_seat', v_button_seat,
      'small_blind_seat', v_small_blind_seat,
      'big_blind_seat', v_big_blind_seat
    )
  );

  perform online_append_hand_event(
    v_hand.id,
    p_table_id,
    'hole_dealt',
    p_started_by_group_player_id,
    jsonb_build_object('seat_count', coalesce(array_length(v_active_seats, 1), 0))
  );

  perform online_append_hand_event(
    v_hand.id,
    p_table_id,
    'blind_posted',
    p_started_by_group_player_id,
    jsonb_build_object(
      'small_blind_seat', v_small_blind_seat,
      'small_blind_amount', v_sb_post,
      'big_blind_seat', v_big_blind_seat,
      'big_blind_amount', v_bb_post
    )
  );

  if v_hand.state = 'showdown' then
    perform online_append_hand_event(
      v_hand.id,
      p_table_id,
      'showdown_ready',
      p_started_by_group_player_id,
      jsonb_build_object('reason', 'no_actionable_players_after_blinds')
    );
  end if;

  perform online_write_hand_snapshot(v_hand.id);
  update online_tables set status = 'active' where id = p_table_id;

  return v_hand;
end;
$$;

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

  perform online_write_hand_snapshot(p_hand_id);
  return v_action;
end;
$$;

create or replace function online_advance_hand(
  p_hand_id uuid,
  p_actor_group_player_id uuid default null,
  p_reason text default 'tick',
  p_host_seat_token text default null
)
returns online_hands
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_table online_tables%rowtype;
  v_host_seat online_table_seats%rowtype;
  v_prev_state text;
  v_next_state text;
  v_board jsonb;
  v_deck_json jsonb;
  v_deck text[];
  v_deck_payload jsonb;
  v_next_actor int;
  v_deal_count int := 0;
  v_burn_card text;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  select * into v_table
  from online_tables
  where id = v_hand.table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  if coalesce(nullif(trim(lower(p_reason)), ''), 'tick') = 'force' then
    if online_active_human_host_group_player(v_hand.table_id) is null then
      if p_actor_group_player_id is null then
        raise exception 'host_identity_required';
      end if;

      perform 1
      from group_players gp
      where gp.id = p_actor_group_player_id
        and gp.group_id = v_table.group_id
        and gp.archived_at is null;
      if not found then
        raise exception 'actor_not_in_group';
      end if;

      perform online_prune_bot_seats(v_hand.table_id);

      update online_tables
      set created_by_group_player_id = online_first_active_human_group_player(v_hand.table_id)
      where id = v_hand.table_id
        and online_active_human_host_group_player(v_hand.table_id) is null;

      select * into v_table
      from online_tables
      where id = v_hand.table_id
      for update;
    end if;

    if p_actor_group_player_id is null
       or p_actor_group_player_id <> v_table.created_by_group_player_id
    then
      raise exception 'host_required_to_force_advance';
    end if;

    if coalesce(nullif(trim(p_host_seat_token), ''), '') = '' then
      raise exception 'host_seat_token_required';
    end if;

    select *
    into v_host_seat
    from online_table_seats
    where table_id = v_hand.table_id
      and group_player_id = v_table.created_by_group_player_id
      and left_at is null
    limit 1;

    if not found then
      raise exception 'host_not_seated';
    end if;

    if v_host_seat.seat_token is distinct from p_host_seat_token then
      raise exception 'host_seat_token_invalid';
    end if;
  end if;

  if v_hand.state in ('settled', 'canceled') then
    return v_hand;
  end if;

  if v_hand.state = 'showdown' then
    raise exception 'showdown_requires_settlement';
  end if;

  if v_hand.state in ('preflop', 'flop', 'turn', 'river')
     and coalesce(v_hand.action_seat, 0) <> 0
     and online_betting_round_complete(p_hand_id) = false
     and coalesce(p_reason, 'tick') not in ('force', 'allin_progress')
  then
    raise exception 'betting_round_not_complete';
  end if;

  v_prev_state := v_hand.state;
  v_next_state := case v_hand.state
    when 'hand_init' then 'post_blinds'
    when 'post_blinds' then 'deal_hole'
    when 'deal_hole' then 'preflop'
    when 'preflop' then 'flop'
    when 'flop' then 'turn'
    when 'turn' then 'river'
    when 'river' then 'showdown'
    else v_hand.state
  end;

  v_board := coalesce(v_hand.board_cards, '[]'::jsonb);
  v_deck_json := online_private.unpack_remaining_deck(v_hand.deck_cards, v_hand.deck_cards_encrypted);
  v_deck := array(
    select jsonb_array_elements_text(coalesce(v_deck_json, '[]'::jsonb))
  );

  v_deal_count := case v_next_state
    when 'flop' then 3
    when 'turn' then 1
    when 'river' then 1
    else 0
  end;

  if v_deal_count > 0 then
    if coalesce(array_length(v_deck, 1), 0) < (v_deal_count + 1) then
      raise exception 'deck_exhausted';
    end if;
    v_burn_card := v_deck[1];
    if v_deal_count = 3 then
      v_board := v_board || jsonb_build_array(v_deck[2], v_deck[3], v_deck[4]);
      v_deck := coalesce(v_deck[5:array_length(v_deck, 1)], array[]::text[]);
    else
      v_board := v_board || jsonb_build_array(v_deck[2]);
      v_deck := coalesce(v_deck[3:array_length(v_deck, 1)], array[]::text[]);
    end if;
  end if;

  if v_next_state in ('flop', 'turn', 'river') then
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
  elsif v_next_state = 'showdown' then
    v_deck_payload := online_private.pack_remaining_deck(to_jsonb(v_deck));
    update online_hands
    set
      state = v_next_state,
      board_cards = v_board,
      deck_cards = coalesce(v_deck_payload->'deck_cards', '[]'::jsonb),
      deck_cards_encrypted = nullif(v_deck_payload->>'deck_cards_encrypted', ''),
      action_seat = null,
      last_action_at = now(),
      turn_grace_used_secs = 0
    where id = p_hand_id
    returning * into v_hand;
  else
    update online_hands
    set
      state = v_next_state,
      last_action_at = now(),
      turn_grace_used_secs = 0
    where id = p_hand_id
    returning * into v_hand;
  end if;

  perform online_append_hand_event(
    v_hand.id,
    v_hand.table_id,
    case
      when v_next_state = 'showdown' then 'showdown_ready'
      when v_next_state in ('flop', 'turn', 'river') then 'street_dealt'
      else 'street_advanced'
    end,
    p_actor_group_player_id,
    jsonb_build_object(
      'from', v_prev_state,
      'to', v_next_state,
      'reason', coalesce(p_reason, 'tick'),
      'board_cards', v_board,
      'burned', v_burn_card is not null
    )
  );

  perform online_write_hand_snapshot(v_hand.id);
  return v_hand;
end;
$$;

do $$
declare
  v_key text;
begin
  v_key := online_private.get_deck_crypto_key();
  if coalesce(v_key, '') = '' then
    return;
  end if;

  update online_hands
  set
    deck_cards_encrypted = encode(
      pgp_sym_encrypt(coalesce(deck_cards, '[]'::jsonb)::text, v_key, 'cipher-algo=aes256,compress-algo=0'),
      'base64'
    ),
    deck_cards = '[]'::jsonb
  where coalesce(deck_cards_encrypted, '') = ''
    and coalesce(jsonb_array_length(deck_cards), 0) > 0;
end;
$$;
