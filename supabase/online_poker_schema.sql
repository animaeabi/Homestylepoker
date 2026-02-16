-- Online Poker (MVP) additive schema
-- Safe to run with existing tracker schema.

create table if not exists online_tables (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  variant text not null default 'nlhe',
  betting_structure text not null default 'no_limit',
  small_blind numeric not null default 1,
  big_blind numeric not null default 2,
  max_seats int not null default 6,
  status text not null default 'waiting' check (status in ('waiting','active','paused','closed')),
  created_by_group_player_id uuid references group_players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists online_table_seats (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references online_tables(id) on delete cascade,
  seat_no int not null,
  group_player_id uuid references group_players(id) on delete set null,
  chip_stack numeric not null default 0,
  is_sitting_out boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (table_id, seat_no)
);

create unique index if not exists idx_online_table_seats_active_player
  on online_table_seats(table_id, group_player_id)
  where left_at is null and group_player_id is not null;

create table if not exists online_hands (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references online_tables(id) on delete cascade,
  hand_no bigint not null,
  state text not null default 'hand_init' check (
    state in (
      'hand_init','post_blinds','deal_hole','preflop','flop','turn','river','showdown','settled','canceled'
    )
  ),
  button_seat int,
  small_blind_seat int,
  big_blind_seat int,
  board_cards jsonb not null default '[]'::jsonb,
  pot_total numeric not null default 0,
  deck_commitment text,
  rng_seed_hash text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (table_id, hand_no)
);

create table if not exists online_hand_players (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references online_hands(id) on delete cascade,
  seat_no int not null,
  group_player_id uuid references group_players(id) on delete set null,
  stack_start numeric not null default 0,
  stack_end numeric,
  committed numeric not null default 0,
  folded boolean not null default false,
  all_in boolean not null default false,
  hole_cards jsonb not null default '[]'::jsonb,
  result_amount numeric not null default 0,
  unique (hand_id, seat_no)
);

create table if not exists online_hand_events (
  id bigserial primary key,
  hand_id uuid not null references online_hands(id) on delete cascade,
  table_id uuid not null references online_tables(id) on delete cascade,
  seq bigint not null,
  event_type text not null,
  actor_group_player_id uuid references group_players(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (hand_id, seq)
);

create index if not exists idx_online_hand_events_hand_created
  on online_hand_events(hand_id, created_at);
create index if not exists idx_online_hand_events_table_created
  on online_hand_events(table_id, created_at);

create table if not exists online_hand_snapshots (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references online_hands(id) on delete cascade,
  table_id uuid not null references online_tables(id) on delete cascade,
  seq bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  unique (hand_id, seq)
);

create index if not exists idx_online_hand_snapshots_hand_seq
  on online_hand_snapshots(hand_id, seq desc);

create table if not exists online_actions (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references online_hands(id) on delete cascade,
  table_id uuid not null references online_tables(id) on delete cascade,
  actor_group_player_id uuid not null references group_players(id) on delete cascade,
  client_action_id text,
  action_type text not null check (action_type in ('fold','check','call','bet','raise','all_in')),
  amount numeric,
  status text not null default 'accepted' check (status in ('accepted','rejected')),
  reject_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_online_actions_dedupe
  on online_actions(hand_id, actor_group_player_id, client_action_id)
  where client_action_id is not null;

-- Keep table updated_at current.
create or replace function set_online_table_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_online_table_updated_at on online_tables;
create trigger trg_set_online_table_updated_at
before update on online_tables
for each row
execute function set_online_table_updated_at();

-- ---------- Online Poker RPCs (M2 foundation) ----------

create or replace function online_next_active_seat(p_active_seats int[], p_after int default null)
returns int
language plpgsql
as $$
declare
  v_seat int;
begin
  if p_active_seats is null or array_length(p_active_seats, 1) is null then
    return null;
  end if;

  if p_after is null then
    return p_active_seats[1];
  end if;

  foreach v_seat in array p_active_seats loop
    if v_seat > p_after then
      return v_seat;
    end if;
  end loop;

  return p_active_seats[1];
end;
$$;

create or replace function online_random_card_token()
returns text
language sql
as $$
  select upper(encode(gen_random_bytes(2), 'hex'));
$$;

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
  select coalesce(max(seq), 0) + 1 into v_seq from online_hand_events where hand_id = p_hand_id;

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

  select coalesce(max(seq), 0) into v_seq
  from online_hand_events
  where hand_id = p_hand_id;

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

create or replace function online_create_table(
  p_group_id uuid,
  p_name text,
  p_created_by_group_player_id uuid default null,
  p_variant text default 'nlhe',
  p_betting_structure text default 'no_limit',
  p_small_blind numeric default 1,
  p_big_blind numeric default 2,
  p_max_seats int default 6
)
returns online_tables
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
begin
  if p_group_id is null then
    raise exception 'group_id_required';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'table_name_required';
  end if;
  if p_small_blind <= 0 or p_big_blind <= 0 then
    raise exception 'invalid_blinds';
  end if;
  if p_small_blind > p_big_blind then
    raise exception 'small_blind_cannot_exceed_big_blind';
  end if;
  if p_max_seats < 2 or p_max_seats > 10 then
    raise exception 'max_seats_out_of_range';
  end if;

  perform 1 from groups where id = p_group_id;
  if not found then
    raise exception 'group_not_found';
  end if;

  if p_created_by_group_player_id is not null then
    perform 1
    from group_players
    where id = p_created_by_group_player_id
      and group_id = p_group_id
      and archived_at is null;
    if not found then
      raise exception 'creator_not_in_group';
    end if;
  end if;

  insert into online_tables(
    group_id,
    name,
    variant,
    betting_structure,
    small_blind,
    big_blind,
    max_seats,
    status,
    created_by_group_player_id
  )
  values (
    p_group_id,
    trim(p_name),
    coalesce(p_variant, 'nlhe'),
    coalesce(p_betting_structure, 'no_limit'),
    p_small_blind,
    p_big_blind,
    p_max_seats,
    'waiting',
    p_created_by_group_player_id
  )
  returning * into v_table;

  insert into online_table_seats(table_id, seat_no, chip_stack)
  select v_table.id, gs, 0
  from generate_series(1, v_table.max_seats) as gs
  on conflict (table_id, seat_no) do nothing;

  return v_table;
end;
$$;

create or replace function online_join_table(
  p_table_id uuid,
  p_group_player_id uuid,
  p_preferred_seat int default null,
  p_chip_stack numeric default 200
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_existing online_table_seats%rowtype;
  v_joined online_table_seats%rowtype;
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
    return v_existing;
  end if;

  if p_preferred_seat is not null then
    if p_preferred_seat < 1 or p_preferred_seat > v_table.max_seats then
      raise exception 'preferred_seat_out_of_range';
    end if;

    update online_table_seats
    set
      group_player_id = p_group_player_id,
      chip_stack = greatest(coalesce(p_chip_stack, 0), 0),
      is_sitting_out = false,
      joined_at = now(),
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
      chip_stack = greatest(coalesce(p_chip_stack, 0), 0),
      is_sitting_out = false,
      joined_at = now(),
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

  return v_joined;
end;
$$;

create or replace function online_leave_table(
  p_table_id uuid,
  p_group_player_id uuid
)
returns online_table_seats
language plpgsql
as $$
declare
  v_left online_table_seats%rowtype;
  v_active_count int;
begin
  update online_table_seats
  set
    group_player_id = null,
    is_sitting_out = false,
    left_at = now()
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
  returning * into v_left;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  select count(*)
  into v_active_count
  from online_table_seats
  where table_id = p_table_id
    and group_player_id is not null
    and left_at is null;

  if v_active_count = 0 then
    update online_tables
    set status = 'waiting'
    where id = p_table_id
      and status = 'active';
  end if;

  return v_left;
end;
$$;

create or replace function online_start_hand(
  p_table_id uuid,
  p_started_by_group_player_id uuid default null
)
returns online_hands
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_active_hand_id uuid;
  v_hand online_hands%rowtype;
  v_hand_no bigint;
  v_active_seats int[];
  v_last_button_seat int;
  v_button_seat int;
  v_small_blind_seat int;
  v_big_blind_seat int;
begin
  select * into v_table from online_tables where id = p_table_id for update;
  if not found then
    raise exception 'online_table_not_found';
  end if;
  if v_table.status = 'closed' then
    raise exception 'online_table_closed';
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
    and not is_sitting_out;

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
  v_small_blind_seat := online_next_active_seat(v_active_seats, v_button_seat);
  v_big_blind_seat := online_next_active_seat(v_active_seats, v_small_blind_seat);

  select coalesce(max(hand_no), 0) + 1 into v_hand_no from online_hands where table_id = p_table_id;

  insert into online_hands(
    table_id,
    hand_no,
    state,
    button_seat,
    small_blind_seat,
    big_blind_seat,
    board_cards,
    pot_total
  )
  values (
    p_table_id,
    v_hand_no,
    'hand_init',
    v_button_seat,
    v_small_blind_seat,
    v_big_blind_seat,
    '[]'::jsonb,
    0
  )
  returning * into v_hand;

  insert into online_hand_players(
    hand_id,
    seat_no,
    group_player_id,
    stack_start,
    stack_end,
    committed,
    folded,
    all_in,
    hole_cards
  )
  select
    v_hand.id,
    s.seat_no,
    s.group_player_id,
    s.chip_stack,
    s.chip_stack,
    0,
    false,
    false,
    '[]'::jsonb
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id is not null
    and s.left_at is null
    and not s.is_sitting_out
  order by s.seat_no;

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
  p_client_action_id text default null
)
returns online_actions
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_hand_player online_hand_players%rowtype;
  v_action online_actions%rowtype;
  v_amount numeric := greatest(coalesce(p_amount, 0), 0);
begin
  select * into v_hand from online_hands where id = p_hand_id for update;
  if not found then
    raise exception 'online_hand_not_found';
  end if;

  if v_hand.state not in ('preflop', 'flop', 'turn', 'river') then
    raise exception 'hand_not_accepting_actions';
  end if;

  if p_client_action_id is not null then
    select * into v_action
    from online_actions
    where hand_id = p_hand_id
      and actor_group_player_id = p_actor_group_player_id
      and client_action_id = p_client_action_id
    order by created_at desc
    limit 1;
    if found then
      return v_action;
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
  if v_hand_player.folded then
    raise exception 'actor_already_folded';
  end if;
  if v_hand_player.all_in then
    raise exception 'actor_already_all_in';
  end if;

  if p_action_type not in ('fold', 'check', 'call', 'bet', 'raise', 'all_in') then
    raise exception 'invalid_action_type';
  end if;

  if p_action_type in ('bet', 'raise', 'call') and v_amount <= 0 then
    raise exception 'positive_amount_required';
  end if;

  if p_action_type = 'all_in' then
    v_amount := greatest(0, coalesce(v_hand_player.stack_end, v_hand_player.stack_start, 0));
  end if;

  if p_action_type = 'fold' then
    update online_hand_players
    set folded = true
    where id = v_hand_player.id;
  elsif p_action_type in ('call', 'bet', 'raise', 'all_in') then
    update online_hand_players
    set
      committed = committed + v_amount,
      stack_end = greatest(0, coalesce(stack_end, stack_start) - v_amount),
      all_in = case when greatest(0, coalesce(stack_end, stack_start) - v_amount) = 0 then true else all_in end
    where id = v_hand_player.id;

    update online_hands
    set pot_total = coalesce(pot_total, 0) + v_amount
    where id = p_hand_id
    returning * into v_hand;
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
    case when p_action_type in ('call', 'bet', 'raise', 'all_in') then v_amount else null end,
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
      'amount', case when p_action_type in ('call', 'bet', 'raise', 'all_in') then v_amount else null end
    )
  );

  perform online_write_hand_snapshot(p_hand_id);
  return v_action;
end;
$$;

create or replace function online_advance_hand(
  p_hand_id uuid,
  p_actor_group_player_id uuid default null,
  p_reason text default 'tick'
)
returns online_hands
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_prev_state text;
  v_next_state text;
  v_board jsonb;
begin
  select * into v_hand from online_hands where id = p_hand_id for update;
  if not found then
    raise exception 'online_hand_not_found';
  end if;
  v_prev_state := v_hand.state;

  case v_hand.state
    when 'hand_init' then v_next_state := 'post_blinds';
    when 'post_blinds' then v_next_state := 'deal_hole';
    when 'deal_hole' then v_next_state := 'preflop';
    when 'preflop' then v_next_state := 'flop';
    when 'flop' then v_next_state := 'turn';
    when 'turn' then v_next_state := 'river';
    when 'river' then v_next_state := 'showdown';
    when 'showdown' then v_next_state := 'settled';
    else
      return v_hand;
  end case;

  v_board := coalesce(v_hand.board_cards, '[]'::jsonb);
  if v_next_state = 'flop' and jsonb_array_length(v_board) < 3 then
    v_board := v_board || jsonb_build_array(
      online_random_card_token(),
      online_random_card_token(),
      online_random_card_token()
    );
  elsif v_next_state = 'turn' and jsonb_array_length(v_board) < 4 then
    v_board := v_board || jsonb_build_array(online_random_card_token());
  elsif v_next_state = 'river' and jsonb_array_length(v_board) < 5 then
    v_board := v_board || jsonb_build_array(online_random_card_token());
  end if;

  update online_hands
  set
    state = v_next_state,
    board_cards = v_board,
    ended_at = case when v_next_state = 'settled' then now() else ended_at end
  where id = p_hand_id
  returning * into v_hand;

  perform online_append_hand_event(
    v_hand.id,
    v_hand.table_id,
    'street_advanced',
    p_actor_group_player_id,
    jsonb_build_object(
      'from', v_prev_state,
      'to', v_next_state,
      'reason', coalesce(p_reason, 'tick'),
      'board_cards', v_board
    )
  );

  if v_next_state = 'settled' then
    perform online_append_hand_event(
      v_hand.id,
      v_hand.table_id,
      'hand_settled',
      p_actor_group_player_id,
      jsonb_build_object('reason', coalesce(p_reason, 'tick'))
    );
  end if;

  perform online_write_hand_snapshot(v_hand.id);
  return v_hand;
end;
$$;

create or replace function online_get_hand_state(
  p_hand_id uuid,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_hand jsonb;
  v_snapshot jsonb;
  v_players jsonb;
  v_events jsonb;
begin
  select to_jsonb(h) into v_hand
  from online_hands h
  where h.id = p_hand_id;

  if v_hand is null then
    raise exception 'online_hand_not_found';
  end if;

  select state into v_snapshot
  from online_hand_snapshots
  where hand_id = p_hand_id
  order by seq desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(hp) order by hp.seat_no), '[]'::jsonb)
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

-- ---------- Online Poker backend completion pass ----------

alter table online_hands
  add column if not exists deck_cards jsonb not null default '[]'::jsonb,
  add column if not exists current_bet numeric not null default 0,
  add column if not exists min_raise numeric not null default 0,
  add column if not exists action_seat int,
  add column if not exists last_action_at timestamptz default now();

alter table online_hand_players
  add column if not exists street_contribution numeric not null default 0,
  add column if not exists has_acted boolean not null default false;

create or replace function online_shuffled_deck()
returns text[]
language sql
as $$
  select array_agg(card order by rnd)
  from (
    select
      rr.rank || ss.suit as card,
      gen_random_uuid() as rnd
    from unnest(array['A','K','Q','J','T','9','8','7','6','5','4','3','2']) as rr(rank)
    cross join unnest(array['s','h','d','c']) as ss(suit)
  ) cards;
$$;

create or replace function online_next_action_seat(
  p_hand_id uuid,
  p_after int
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
    and coalesce(stack_end, 0) > 0;

  return online_next_active_seat(v_actionable_seats, p_after);
end;
$$;

create or replace function online_betting_round_complete(p_hand_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_target_bet numeric;
  v_unsettled_count int;
begin
  select coalesce(max(street_contribution), 0)
  into v_target_bet
  from online_hand_players
  where hand_id = p_hand_id
    and not folded;

  select count(*)
  into v_unsettled_count
  from online_hand_players
  where hand_id = p_hand_id
    and not folded
    and not all_in
    and (
      coalesce(has_acted, false) = false
      or coalesce(street_contribution, 0) <> v_target_bet
    );

  return v_unsettled_count = 0;
end;
$$;

create or replace function online_start_hand(
  p_table_id uuid,
  p_started_by_group_player_id uuid default null
)
returns online_hands
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
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
  v_small_blind_seat := online_next_active_seat(v_active_seats, v_button_seat);
  v_big_blind_seat := online_next_active_seat(v_active_seats, v_small_blind_seat);

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
      jsonb_build_array(v_deck[v_cursor], v_deck[v_cursor + 1])
    );
    v_cursor := v_cursor + 2;
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

create or replace function online_submit_action(
  p_hand_id uuid,
  p_actor_group_player_id uuid,
  p_action_type text,
  p_amount numeric default null,
  p_client_action_id text default null
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
  v_start_idx int;
  v_winner_seat int;
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
  else
    v_round_done := online_betting_round_complete(p_hand_id);

    if v_round_done then
      if v_hand.state = 'river' then
        update online_hands
        set
          state = 'showdown',
          action_seat = null,
          last_action_at = now()
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

        if coalesce(array_length(v_deck, 1), 0) < v_deal_count then
          raise exception 'deck_exhausted';
        end if;

        if v_deal_count > 0 then
          v_start_idx := coalesce(jsonb_array_length(v_board), 0) + 1;
          if v_deal_count = 3 then
            v_board := v_board || jsonb_build_array(v_deck[1], v_deck[2], v_deck[3]);
            v_deck := coalesce(v_deck[4:array_length(v_deck, 1)], array[]::text[]);
          else
            v_board := v_board || jsonb_build_array(v_deck[1]);
            v_deck := coalesce(v_deck[2:array_length(v_deck, 1)], array[]::text[]);
          end if;
        end if;

        update online_hand_players
        set
          street_contribution = 0,
          has_acted = false
        where hand_id = p_hand_id
          and not folded;

        v_next_actor := online_next_action_seat(p_hand_id, v_hand.button_seat);

        update online_hands
        set
          state = v_next_state,
          board_cards = v_board,
          deck_cards = to_jsonb(v_deck),
          current_bet = 0,
          min_raise = greatest(coalesce(v_table.big_blind, 1), 1),
          action_seat = v_next_actor,
          last_action_at = now()
        where id = p_hand_id
        returning * into v_hand;

        perform online_append_hand_event(
          p_hand_id,
          v_hand.table_id,
          'street_dealt',
          p_actor_group_player_id,
          jsonb_build_object(
            'street', v_next_state,
            'board_cards', v_board
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
      'street', v_hand.state
    )
  );

  perform online_write_hand_snapshot(p_hand_id);
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

create or replace function online_get_table_state(
  p_table_id uuid,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
begin
  select to_jsonb(t) into v_table
  from online_tables t
  where t.id = p_table_id;

  if v_table is null then
    raise exception 'online_table_not_found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.seat_no), '[]'::jsonb)
  into v_seats
  from online_table_seats s
  where s.table_id = p_table_id;

  select h.id
  into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state(v_hand_id, p_since_seq);
  end if;

  return jsonb_build_object(
    'table', v_table,
    'seats', coalesce(v_seats, '[]'::jsonb),
    'latest_hand', coalesce(v_hand_state, '{}'::jsonb)
  );
end;
$$;

create or replace function online_advance_hand(
  p_hand_id uuid,
  p_actor_group_player_id uuid default null,
  p_reason text default 'tick'
)
returns online_hands
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_table online_tables%rowtype;
  v_prev_state text;
  v_next_state text;
  v_board jsonb;
  v_deck text[];
  v_next_actor int;
  v_deal_count int := 0;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
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
  v_deck := array(
    select jsonb_array_elements_text(coalesce(v_hand.deck_cards, '[]'::jsonb))
  );

  v_deal_count := case v_next_state
    when 'flop' then 3
    when 'turn' then 1
    when 'river' then 1
    else 0
  end;

  if v_deal_count > 0 then
    if coalesce(array_length(v_deck, 1), 0) < v_deal_count then
      raise exception 'deck_exhausted';
    end if;
    if v_deal_count = 3 then
      v_board := v_board || jsonb_build_array(v_deck[1], v_deck[2], v_deck[3]);
      v_deck := coalesce(v_deck[4:array_length(v_deck, 1)], array[]::text[]);
    else
      v_board := v_board || jsonb_build_array(v_deck[1]);
      v_deck := coalesce(v_deck[2:array_length(v_deck, 1)], array[]::text[]);
    end if;
  end if;

  if v_next_state in ('flop', 'turn', 'river') then
    select * into v_table from online_tables where id = v_hand.table_id;

    update online_hand_players
    set
      street_contribution = 0,
      has_acted = false
    where hand_id = p_hand_id
      and not folded;

    v_next_actor := online_next_action_seat(p_hand_id, v_hand.button_seat);

    update online_hands
    set
      state = v_next_state,
      board_cards = v_board,
      deck_cards = to_jsonb(v_deck),
      current_bet = 0,
      min_raise = greatest(coalesce(v_table.big_blind, 1), 1),
      action_seat = v_next_actor,
      last_action_at = now()
    where id = p_hand_id
    returning * into v_hand;
  elsif v_next_state = 'showdown' then
    update online_hands
    set
      state = v_next_state,
      board_cards = v_board,
      deck_cards = to_jsonb(v_deck),
      action_seat = null,
      last_action_at = now()
    where id = p_hand_id
    returning * into v_hand;
  else
    update online_hands
    set
      state = v_next_state,
      last_action_at = now()
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
      'board_cards', v_board
    )
  );

  perform online_write_hand_snapshot(v_hand.id);
  return v_hand;
end;
$$;
