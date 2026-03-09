alter table online_hand_players
  add column if not exists stat_vpip_recorded boolean not null default false;

alter table online_hand_players
  add column if not exists stat_pfr_recorded boolean not null default false;

create table if not exists online_player_read_profiles (
  group_player_id uuid primary key references group_players(id) on delete cascade,
  hands_observed numeric not null default 0,
  vpip_hands numeric not null default 0,
  pfr_hands numeric not null default 0,
  faced_bet_events numeric not null default 0,
  fold_to_bet_events numeric not null default 0,
  postflop_bet_events numeric not null default 0,
  postflop_call_events numeric not null default 0,
  river_faced_bet_events numeric not null default 0,
  river_fold_events numeric not null default 0,
  showdown_wins numeric not null default 0,
  showdown_losses numeric not null default 0,
  aggressive_showdown_losses numeric not null default 0,
  trap_showdown_wins numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists online_table_player_read_profiles (
  table_id uuid not null references online_tables(id) on delete cascade,
  group_player_id uuid not null references group_players(id) on delete cascade,
  hands_observed int not null default 0,
  vpip_hands int not null default 0,
  pfr_hands int not null default 0,
  faced_bet_events int not null default 0,
  fold_to_bet_events int not null default 0,
  postflop_bet_events int not null default 0,
  postflop_call_events int not null default 0,
  river_faced_bet_events int not null default 0,
  river_fold_events int not null default 0,
  showdown_wins int not null default 0,
  showdown_losses int not null default 0,
  aggressive_showdown_losses int not null default 0,
  trap_showdown_wins int not null default 0,
  net_result numeric not null default 0,
  recent_aggression_ema numeric not null default 0,
  recent_call_ema numeric not null default 0,
  recent_fold_ema numeric not null default 0,
  consecutive_losses int not null default 0,
  last_showdown_result text,
  last_showdown_at timestamptz,
  actions_since_showdown int not null default 999,
  updated_at timestamptz not null default now(),
  primary key (table_id, group_player_id)
);

drop function if exists online_bot_profile_is_human(uuid, uuid);
create or replace function online_bot_profile_is_human(
  p_table_id uuid,
  p_group_player_id uuid
)
returns boolean
language sql
stable
as $$
  select
    exists (
      select 1
      from group_players gp
      where gp.id = p_group_player_id
        and gp.archived_at is null
        and coalesce(gp.name, '') not ilike 'Bot %'
    )
    and not exists (
      select 1
      from online_table_seats s
      where s.table_id = p_table_id
        and s.group_player_id = p_group_player_id
        and s.left_at is null
        and coalesce(s.is_bot, false)
    );
$$;

drop function if exists online_bot_profile_ema(numeric, numeric, numeric);
create or replace function online_bot_profile_ema(
  p_prev numeric,
  p_observation numeric,
  p_alpha numeric default 0.25
)
returns numeric
language sql
immutable
as $$
  select (coalesce(p_prev, 0) * (1 - greatest(0, least(coalesce(p_alpha, 0.25), 1))))
       + (coalesce(p_observation, 0) * greatest(0, least(coalesce(p_alpha, 0.25), 1)));
$$;

drop function if exists online_bot_profile_ensure(uuid, uuid);
create or replace function online_bot_profile_ensure(
  p_table_id uuid,
  p_group_player_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_group_player_id is null or not online_bot_profile_is_human(p_table_id, p_group_player_id) then
    return;
  end if;

  insert into online_player_read_profiles(group_player_id)
  values (p_group_player_id)
  on conflict (group_player_id) do nothing;

  insert into online_table_player_read_profiles(table_id, group_player_id)
  values (p_table_id, p_group_player_id)
  on conflict (table_id, group_player_id) do nothing;
end;
$$;

drop function if exists online_bot_profile_record_hand_start(uuid, uuid);
create or replace function online_bot_profile_record_hand_start(
  p_table_id uuid,
  p_group_player_id uuid
)
returns void
language plpgsql
as $$
declare
  v_decay numeric := 0.985;
begin
  if p_group_player_id is null or not online_bot_profile_is_human(p_table_id, p_group_player_id) then
    return;
  end if;

  perform online_bot_profile_ensure(p_table_id, p_group_player_id);

  update online_player_read_profiles
  set
    hands_observed = (hands_observed * v_decay) + 1,
    vpip_hands = vpip_hands * v_decay,
    pfr_hands = pfr_hands * v_decay,
    faced_bet_events = faced_bet_events * v_decay,
    fold_to_bet_events = fold_to_bet_events * v_decay,
    postflop_bet_events = postflop_bet_events * v_decay,
    postflop_call_events = postflop_call_events * v_decay,
    river_faced_bet_events = river_faced_bet_events * v_decay,
    river_fold_events = river_fold_events * v_decay,
    showdown_wins = showdown_wins * v_decay,
    showdown_losses = showdown_losses * v_decay,
    aggressive_showdown_losses = aggressive_showdown_losses * v_decay,
    trap_showdown_wins = trap_showdown_wins * v_decay,
    updated_at = now()
  where group_player_id = p_group_player_id;

  update online_table_player_read_profiles
  set
    hands_observed = hands_observed + 1,
    actions_since_showdown = least(coalesce(actions_since_showdown, 999) + 1, 999),
    updated_at = now()
  where table_id = p_table_id
    and group_player_id = p_group_player_id;
end;
$$;

drop function if exists online_bot_profile_record_action(uuid, uuid, text, text, boolean, boolean, boolean);
create or replace function online_bot_profile_record_action(
  p_table_id uuid,
  p_group_player_id uuid,
  p_street text,
  p_action_type text,
  p_facing_bet boolean default false,
  p_record_vpip boolean default false,
  p_record_pfr boolean default false
)
returns void
language plpgsql
as $$
declare
  v_aggressive boolean := coalesce(p_street, '') <> 'preflop' and p_action_type in ('bet', 'raise', 'all_in');
  v_call boolean := coalesce(p_street, '') <> 'preflop' and p_action_type = 'call';
  v_fold_to_bet boolean := coalesce(p_facing_bet, false) and p_action_type = 'fold';
  v_river_face boolean := coalesce(p_street, '') = 'river' and coalesce(p_facing_bet, false);
  v_river_fold boolean := v_river_face and p_action_type = 'fold';
begin
  if p_group_player_id is null or not online_bot_profile_is_human(p_table_id, p_group_player_id) then
    return;
  end if;

  perform online_bot_profile_ensure(p_table_id, p_group_player_id);

  update online_player_read_profiles
  set
    vpip_hands = vpip_hands + case when coalesce(p_record_vpip, false) then 1 else 0 end,
    pfr_hands = pfr_hands + case when coalesce(p_record_pfr, false) then 1 else 0 end,
    faced_bet_events = faced_bet_events + case when coalesce(p_facing_bet, false) then 1 else 0 end,
    fold_to_bet_events = fold_to_bet_events + case when v_fold_to_bet then 1 else 0 end,
    postflop_bet_events = postflop_bet_events + case when v_aggressive then 1 else 0 end,
    postflop_call_events = postflop_call_events + case when v_call then 1 else 0 end,
    river_faced_bet_events = river_faced_bet_events + case when v_river_face then 1 else 0 end,
    river_fold_events = river_fold_events + case when v_river_fold then 1 else 0 end,
    updated_at = now()
  where group_player_id = p_group_player_id;

  update online_table_player_read_profiles
  set
    vpip_hands = vpip_hands + case when coalesce(p_record_vpip, false) then 1 else 0 end,
    pfr_hands = pfr_hands + case when coalesce(p_record_pfr, false) then 1 else 0 end,
    faced_bet_events = faced_bet_events + case when coalesce(p_facing_bet, false) then 1 else 0 end,
    fold_to_bet_events = fold_to_bet_events + case when v_fold_to_bet then 1 else 0 end,
    postflop_bet_events = postflop_bet_events + case when v_aggressive then 1 else 0 end,
    postflop_call_events = postflop_call_events + case when v_call then 1 else 0 end,
    river_faced_bet_events = river_faced_bet_events + case when v_river_face then 1 else 0 end,
    river_fold_events = river_fold_events + case when v_river_fold then 1 else 0 end,
    recent_aggression_ema = online_bot_profile_ema(recent_aggression_ema, case when v_aggressive then 1 else 0 end, 0.28),
    recent_call_ema = online_bot_profile_ema(recent_call_ema, case when v_call then 1 else 0 end, 0.24),
    recent_fold_ema = online_bot_profile_ema(recent_fold_ema, case when v_fold_to_bet then 1 else 0 end, 0.24),
    actions_since_showdown = least(coalesce(actions_since_showdown, 999) + 1, 999),
    updated_at = now()
  where table_id = p_table_id
    and group_player_id = p_group_player_id;
end;
$$;

drop function if exists online_bot_profile_record_hand_completion(uuid, boolean);
create or replace function online_bot_profile_record_hand_completion(
  p_hand_id uuid,
  p_showdown boolean default false
)
returns void
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_row record;
  v_net_change numeric;
  v_outcome text;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id;

  if not found then
    return;
  end if;

  for v_row in
    select
      hp.group_player_id,
      hp.committed,
      hp.result_amount,
      hp.folded,
      exists (
        select 1
        from online_hand_events ev
        where ev.hand_id = p_hand_id
          and ev.event_type = 'action_taken'
          and ev.actor_group_player_id = hp.group_player_id
          and coalesce(ev.payload->>'action_type', '') in ('bet', 'raise', 'all_in')
      ) as was_aggressor
    from online_hand_players hp
    where hp.hand_id = p_hand_id
      and hp.group_player_id is not null
  loop
    if not online_bot_profile_is_human(v_hand.table_id, v_row.group_player_id) then
      continue;
    end if;

    perform online_bot_profile_ensure(v_hand.table_id, v_row.group_player_id);

    v_net_change := coalesce(v_row.result_amount, 0) - coalesce(v_row.committed, 0);
    v_outcome := case
      when v_net_change > 0.01 then 'won'
      when v_net_change < -0.01 then 'lost'
      else 'split'
    end;

    if p_showdown then
      update online_player_read_profiles
      set
        showdown_wins = showdown_wins + case when v_outcome = 'won' then 1 else 0 end,
        showdown_losses = showdown_losses + case when v_outcome = 'lost' then 1 else 0 end,
        aggressive_showdown_losses = aggressive_showdown_losses + case when v_outcome = 'lost' and v_row.was_aggressor then 1 else 0 end,
        trap_showdown_wins = trap_showdown_wins + case when v_outcome = 'won' and not v_row.was_aggressor then 1 else 0 end,
        updated_at = now()
      where group_player_id = v_row.group_player_id;
    end if;

    update online_table_player_read_profiles
    set
      net_result = net_result + v_net_change,
      showdown_wins = showdown_wins + case when p_showdown and v_outcome = 'won' then 1 else 0 end,
      showdown_losses = showdown_losses + case when p_showdown and v_outcome = 'lost' then 1 else 0 end,
      aggressive_showdown_losses = aggressive_showdown_losses + case when p_showdown and v_outcome = 'lost' and v_row.was_aggressor then 1 else 0 end,
      trap_showdown_wins = trap_showdown_wins + case when p_showdown and v_outcome = 'won' and not v_row.was_aggressor then 1 else 0 end,
      consecutive_losses = case when v_outcome = 'lost' then consecutive_losses + 1 else 0 end,
      last_showdown_result = case when p_showdown then v_outcome else last_showdown_result end,
      last_showdown_at = case when p_showdown then now() else last_showdown_at end,
      actions_since_showdown = case when p_showdown then 0 else actions_since_showdown end,
      updated_at = now()
    where table_id = v_hand.table_id
      and group_player_id = v_row.group_player_id;
  end loop;
end;
$$;

drop function if exists online_get_bot_opponent_profiles(uuid);
create or replace function online_get_bot_opponent_profiles(
  p_table_id uuid
)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_player_id', s.group_player_id,
        'seat_no', s.seat_no,
        'player_name', gp.name,
        'chip_stack', s.chip_stack,
        'overall', coalesce(to_jsonb(op) - 'group_player_id', '{}'::jsonb),
        'session', coalesce(to_jsonb(sp) - 'table_id' - 'group_player_id', '{}'::jsonb)
      )
      order by s.seat_no
    ),
    '[]'::jsonb
  )
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  left join online_player_read_profiles op on op.group_player_id = s.group_player_id
  left join online_table_player_read_profiles sp
    on sp.table_id = s.table_id
   and sp.group_player_id = s.group_player_id
  where s.table_id = p_table_id
    and s.group_player_id is not null
    and s.left_at is null
    and not coalesce(s.is_bot, false)
    and coalesce(gp.name, '') not ilike 'Bot %';
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
  v_deck text[];
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

  v_deck := online_shuffled_deck();

  insert into online_hands(
    table_id,
    hand_no,
    state,
    button_seat,
    small_blind_seat,
    big_blind_seat,
    board_cards,
    pot_total,
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
      v_seat.chip_stack,
      v_seat.chip_stack,
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
    street_contribution = least(coalesce(stack_end, 0), v_table.small_blind),
    committed = least(coalesce(stack_end, 0), v_table.small_blind),
    stack_end = greatest(0, coalesce(stack_end, 0) - v_table.small_blind),
    all_in = greatest(0, coalesce(stack_end, 0) - v_table.small_blind) = 0
  where hand_id = v_hand.id
    and seat_no = v_small_blind_seat
  returning street_contribution into v_sb_post;

  update online_hand_players
  set
    street_contribution = least(coalesce(stack_end, 0), v_table.big_blind),
    committed = least(coalesce(stack_end, 0), v_table.big_blind),
    stack_end = greatest(0, coalesce(stack_end, 0) - v_table.big_blind),
    all_in = greatest(0, coalesce(stack_end, 0) - v_table.big_blind) = 0
  where hand_id = v_hand.id
    and seat_no = v_big_blind_seat
  returning street_contribution into v_bb_post;

  v_sb_post := coalesce(v_sb_post, 0);
  v_bb_post := coalesce(v_bb_post, 0);
  v_pot_total := v_sb_post + v_bb_post;
  v_action_seat := online_next_action_seat(v_hand.id, v_big_blind_seat);
  v_remaining := coalesce(v_deck[v_cursor:array_length(v_deck, 1)], array[]::text[]);

  update online_hands
  set
    pot_total = v_pot_total,
    current_bet = greatest(v_sb_post, v_bb_post),
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

  if p_action_type not in ('fold', 'check', 'call', 'bet', 'raise', 'all_in') then
    raise exception 'invalid_action_type';
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
        last_action_at = now()
      where id = p_hand_id
      returning * into v_hand;
    elsif v_is_full_raise then
      update online_hands
      set
        current_bet = v_new_street_contribution,
        min_raise = greatest(coalesce(v_table.big_blind, 1), v_new_street_contribution - v_prev_bet),
        last_action_at = now()
      where id = p_hand_id
      returning * into v_hand;
    else
      update online_hands
      set
        current_bet = greatest(current_bet, v_new_street_contribution),
        last_action_at = now()
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
      last_action_at = now()
    where id = p_hand_id
    returning * into v_hand;

    perform online_append_hand_event(
      p_hand_id,
      v_hand.table_id,
      'hand_won_uncontested',
      p_actor_group_player_id,
      jsonb_build_object(
        'winner_seat', v_winner_seat,
        'pot_total', v_hand.pot_total
      )
    );

    perform online_bot_profile_record_hand_completion(
      p_hand_id,
      false
    );

    perform online_write_hand_snapshot(p_hand_id);

    insert into online_actions(
      hand_id,
      table_id,
      actor_group_player_id,
      client_action_id,
      action_type,
      amount
    )
    values (
      p_hand_id,
      v_hand.table_id,
      p_actor_group_player_id,
      p_client_action_id,
      p_action_type,
      case
        when p_action_type in ('raise', 'bet') then v_new_street_contribution
        when p_action_type = 'all_in' then v_add
        else null
      end
    )
    returning * into v_action;

    return v_action;
  end if;

  v_round_done := online_betting_round_complete(p_hand_id);

  if v_round_done then
    if v_hand.state = 'river' then
      update online_hands
      set
        state = 'showdown',
        action_seat = null,
        current_bet = 0,
        min_raise = greatest(1, coalesce(v_table.big_blind, 1)),
        last_action_at = now()
      where id = p_hand_id
      returning * into v_hand;

      perform online_append_hand_event(
        p_hand_id,
        v_hand.table_id,
        'showdown_ready',
        p_actor_group_player_id,
        jsonb_build_object('reason', 'river_complete')
      );
    else
      if coalesce(jsonb_array_length(v_hand.deck_cards), 0) <= 0 then
        raise exception 'deck_exhausted';
      end if;

      v_deck := array(select jsonb_array_elements_text(v_hand.deck_cards));
      v_burn_card := v_deck[1];

      if v_hand.state = 'preflop' then
        v_deal_count := 3;
        v_next_state := 'flop';
      elsif v_hand.state = 'flop' then
        v_deal_count := 1;
        v_next_state := 'turn';
      else
        v_deal_count := 1;
        v_next_state := 'river';
      end if;

      v_board := coalesce(v_hand.board_cards, '[]'::jsonb);
      if array_length(v_deck, 1) < v_deal_count + 1 then
        raise exception 'deck_exhausted';
      end if;

      for i in 1..v_deal_count loop
        v_board := v_board || to_jsonb(v_deck[i + 1]);
      end loop;

      v_deck := coalesce(v_deck[(v_deal_count + 2):array_length(v_deck, 1)], array[]::text[]);

      update online_hand_players
      set
        street_contribution = 0,
        has_acted = false
      where hand_id = p_hand_id
        and not folded
        and not all_in;

      v_next_actor := online_first_postflop_action_seat(p_hand_id, v_hand.button_seat);

      update online_hands
      set
        state = v_next_state,
        board_cards = v_board,
        deck_cards = to_jsonb(v_deck),
        current_bet = 0,
        min_raise = greatest(1, coalesce(v_table.big_blind, 1)),
        action_seat = v_next_actor,
        last_action_at = now()
      where id = p_hand_id
      returning * into v_hand;

      perform online_append_hand_event(
        p_hand_id,
        v_hand.table_id,
        'board_revealed',
        p_actor_group_player_id,
        jsonb_build_object(
          'street', v_next_state,
          'board_cards', v_board,
          'count', v_deal_count,
          'burn_card', v_burn_card
        )
      );
    end if;
  else
    v_next_actor := online_next_action_seat(p_hand_id, v_hand_player.seat_no);
    update online_hands
    set
      action_seat = v_next_actor,
      last_action_at = now()
    where id = p_hand_id
    returning * into v_hand;
  end if;

  perform online_append_hand_event(
    p_hand_id,
    v_hand.table_id,
    'action_taken',
    p_actor_group_player_id,
    jsonb_build_object(
      'action_type', p_action_type,
      'amount', case
        when p_action_type in ('raise', 'bet') then v_new_street_contribution
        when p_action_type = 'all_in' then v_add
        else null
      end,
      'to_call', v_to_call,
      'seat_no', v_hand_player.seat_no,
      'state', v_action_street
    )
  );

  perform online_write_hand_snapshot(p_hand_id);

  insert into online_actions(
    hand_id,
    table_id,
    actor_group_player_id,
    client_action_id,
    action_type,
    amount
  )
  values (
    p_hand_id,
    v_hand.table_id,
    p_actor_group_player_id,
    p_client_action_id,
    p_action_type,
    case
      when p_action_type in ('raise', 'bet') then v_new_street_contribution
      when p_action_type = 'all_in' then v_add
      else null
    end
  )
  returning * into v_action;

  return v_action;
end;
$$;

create or replace function online_settle_showdown(
  p_hand_id uuid,
  p_payouts jsonb,
  p_actor_group_player_id uuid default null,
  p_note text default null
)
returns online_hands
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_sum_payouts numeric := 0;
  v_payout record;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
  end if;
  if v_hand.state <> 'showdown' then
    raise exception 'hand_not_in_showdown';
  end if;
  if jsonb_typeof(coalesce(p_payouts, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_payouts_payload';
  end if;

  for v_payout in
    select
      (row_item->>'seat_no')::int as seat_no,
      coalesce((row_item->>'amount')::numeric, 0) as amount
    from jsonb_array_elements(coalesce(p_payouts, '[]'::jsonb)) as row_item
  loop
    if v_payout.seat_no is null then
      raise exception 'payout_missing_seat';
    end if;
    if v_payout.amount < 0 then
      raise exception 'payout_amount_negative';
    end if;

    perform 1
    from online_hand_players
    where hand_id = p_hand_id
      and seat_no = v_payout.seat_no;
    if not found then
      raise exception 'payout_seat_not_in_hand';
    end if;

    v_sum_payouts := v_sum_payouts + v_payout.amount;
  end loop;

  if abs(v_sum_payouts - coalesce(v_hand.pot_total, 0)) > 0.01 then
    raise exception 'payout_sum_mismatch';
  end if;

  update online_hand_players
  set result_amount = 0
  where hand_id = p_hand_id;

  for v_payout in
    select
      (row_item->>'seat_no')::int as seat_no,
      coalesce((row_item->>'amount')::numeric, 0) as amount
    from jsonb_array_elements(coalesce(p_payouts, '[]'::jsonb)) as row_item
  loop
    update online_hand_players
    set
      result_amount = v_payout.amount,
      stack_end = coalesce(stack_end, 0) + v_payout.amount
    where hand_id = p_hand_id
      and seat_no = v_payout.seat_no;
  end loop;

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
    last_action_at = now()
  where id = p_hand_id
  returning * into v_hand;

  perform online_bot_profile_record_hand_completion(
    p_hand_id,
    true
  );

  perform online_append_hand_event(
    p_hand_id,
    v_hand.table_id,
    'pot_awarded',
    p_actor_group_player_id,
    jsonb_build_object(
      'payouts', coalesce(p_payouts, '[]'::jsonb),
      'note', coalesce(p_note, '')
    )
  );

  perform online_append_hand_event(
    p_hand_id,
    v_hand.table_id,
    'hand_settled',
    p_actor_group_player_id,
    jsonb_build_object(
      'reason', 'showdown_resolved',
      'note', coalesce(p_note, '')
    )
  );

  perform online_write_hand_snapshot(p_hand_id);
  return v_hand;
end;
$$;
