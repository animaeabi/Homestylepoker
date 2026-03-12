drop function if exists online_secure_shuffle_bundle();
create or replace function online_secure_shuffle_bundle()
returns jsonb
language plpgsql
as $$
declare
  v_deck text[];
  v_i int;
  v_j int;
  v_tmp text;
  v_draw bytea;
  v_entropy bytea := ''::bytea;
  v_u32 bigint;
  v_limit bigint;
begin
  select array_agg(rr.rank || ss.suit)
  into v_deck
  from unnest(array['A','K','Q','J','T','9','8','7','6','5','4','3','2']) as rr(rank)
  cross join unnest(array['s','h','d','c']) as ss(suit);

  for v_i in reverse 52..2 loop
    v_limit := 4294967296::bigint - mod(4294967296::bigint, v_i::bigint);
    loop
      v_draw := gen_random_bytes(4);
      v_entropy := v_entropy || v_draw;
      v_u32 := (get_byte(v_draw, 0)::bigint << 24)
             + (get_byte(v_draw, 1)::bigint << 16)
             + (get_byte(v_draw, 2)::bigint << 8)
             + get_byte(v_draw, 3)::bigint;
      exit when v_u32 < v_limit;
    end loop;

    v_j := ((v_u32 % v_i::bigint)::int) + 1;
    if v_i <> v_j then
      v_tmp := v_deck[v_i];
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_tmp;
    end if;
  end loop;

  return jsonb_build_object(
    'deck', to_jsonb(v_deck),
    'deck_commitment', encode(digest(convert_to(array_to_string(v_deck, ','), 'utf8'), 'sha256'), 'hex'),
    'rng_seed_hash', encode(digest(v_entropy, 'sha256'), 'hex')
  );
end;
$$;

create or replace function online_shuffled_deck()
returns text[]
language plpgsql
as $$
declare
  v_bundle jsonb;
begin
  v_bundle := online_secure_shuffle_bundle();
  return array(
    select jsonb_array_elements_text(coalesce(v_bundle->'deck', '[]'::jsonb))
  );
end;
$$;

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

  v_hand := to_jsonb(v_hand_row) - 'deck_cards';
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
        when v_reveal_all
             or (v_viewer_seat_no is not null and hp.seat_no = v_viewer_seat_no)
          then to_jsonb(hp)
        else (to_jsonb(hp) - 'hole_cards') || jsonb_build_object('hole_cards', '[]'::jsonb)
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

  update online_hands
  set
    pot_total = online_normalize_money(v_pot_total),
    current_bet = online_normalize_money(greatest(v_sb_post, v_bb_post)),
    min_raise = greatest(1, coalesce(v_table.big_blind, 1)),
    action_seat = v_action_seat,
    deck_cards = to_jsonb(v_remaining),
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
