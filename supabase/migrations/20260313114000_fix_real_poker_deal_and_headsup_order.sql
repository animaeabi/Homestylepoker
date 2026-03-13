drop function if exists online_first_postflop_action_seat(uuid, int);
create or replace function online_first_postflop_action_seat(
  p_hand_id uuid,
  p_button_seat int
)
returns int
language plpgsql
as $$
declare
  v_actionable_seats int[];
begin
  select array_agg(seat_no order by seat_no)
  into v_actionable_seats
  from online_hand_players
  where hand_id = p_hand_id
    and not folded
    and not all_in
    and online_normalize_money(coalesce(stack_end, 0)) > 0;

  if coalesce(array_length(v_actionable_seats, 1), 0) = 0 then
    return null;
  end if;

  -- If only one player still has chips behind, betting is closed.
  -- The runtime should continue dealing streets / showdown without
  -- granting that player another decision they cannot be contested on.
  if coalesce(array_length(v_actionable_seats, 1), 0) = 1 then
    return null;
  end if;

  return online_next_active_seat(v_actionable_seats, p_button_seat);
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
  v_deal_order int[];
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

  -- Recover host ownership when the declared host left or a bot was promoted.
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
    -- Heads-up: dealer posts SB, other player posts BB and dealer receives the first card.
    v_small_blind_seat := v_button_seat;
    v_big_blind_seat := online_next_active_seat(v_active_seats, v_button_seat);
    v_deal_order := array[v_button_seat, v_big_blind_seat];
  else
    v_small_blind_seat := online_next_active_seat(v_active_seats, v_button_seat);
    v_big_blind_seat := online_next_active_seat(v_active_seats, v_small_blind_seat);
    v_deal_order := array[]::int[];
    v_seat_no := online_next_active_seat(v_active_seats, v_button_seat);
    while v_seat_no is not null and not (v_seat_no = any(v_deal_order)) loop
      v_deal_order := array_append(v_deal_order, v_seat_no);
      v_seat_no := online_next_active_seat(v_active_seats, v_seat_no);
    end loop;
  end if;

  if coalesce(array_length(v_deal_order, 1), 0) <> coalesce(array_length(v_active_seats, 1), 0) then
    v_deal_order := v_active_seats;
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

  -- Deal hole cards like a real table: one card per seat, two rounds.
  for v_round in 1..2 loop
    foreach v_seat_no in array v_deal_order loop
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
