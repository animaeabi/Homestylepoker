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
  auto_deal_enabled boolean not null default true,
  showdown_delay_secs int not null default 5,
  decision_time_secs int not null default 25,
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
  seat_token text not null default encode(gen_random_bytes(16), 'hex'),
  bot_personality text,
  bot_rebuy_count int not null default 0,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (table_id, seat_no)
);

-- Migration-safe: add seat token to existing installs where table already existed.
alter table online_table_seats
  add column if not exists seat_token text not null default encode(gen_random_bytes(16), 'hex');

alter table online_table_seats
  add column if not exists is_bot boolean not null default false;

alter table online_table_seats
  add column if not exists bot_personality text;

alter table online_table_seats
  add column if not exists bot_rebuy_count int not null default 0;

alter table online_table_seats
  add column if not exists auto_check_when_available boolean not null default false;

drop function if exists online_active_human_host_group_player(uuid);
create or replace function online_active_human_host_group_player(p_table_id uuid)
returns uuid
language sql
stable
as $$
  select t.created_by_group_player_id
  from online_tables t
  join online_table_seats s
    on s.table_id = t.id
   and s.group_player_id = t.created_by_group_player_id
   and s.left_at is null
  left join group_players gp on gp.id = s.group_player_id
  where t.id = p_table_id
    and not (coalesce(s.is_bot, false) or coalesce(gp.name, '') ilike 'Bot %')
  limit 1;
$$;

drop function if exists online_first_active_human_group_player(uuid);
create or replace function online_first_active_human_group_player(p_table_id uuid)
returns uuid
language sql
stable
as $$
  select s.group_player_id
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id
    and s.group_player_id is not null
    and s.left_at is null
    and not (coalesce(s.is_bot, false) or coalesce(gp.name, '') ilike 'Bot %')
  order by s.seat_no
  limit 1;
$$;

drop function if exists online_prune_bot_seats(uuid);
create or replace function online_prune_bot_seats(p_table_id uuid)
returns integer
language plpgsql
as $$
declare
  v_removed int := 0;
begin
  update online_table_seats s
  set
    group_player_id = null,
    is_bot = false,
    is_sitting_out = false,
    seat_token = encode(gen_random_bytes(16), 'hex'),
    left_at = now()
  from group_players gp
  where s.table_id = p_table_id
    and s.group_player_id = gp.id
    and s.left_at is null
    and (coalesce(s.is_bot, false) or gp.name ilike 'Bot %');

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create unique index if not exists idx_online_table_seats_active_player
  on online_table_seats(table_id, group_player_id)
  where left_at is null and group_player_id is not null;

create unique index if not exists idx_online_table_seats_active_token
  on online_table_seats(table_id, seat_token)
  where left_at is null and seat_token is not null;

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
  deck_cards_encrypted text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  turn_grace_used_secs int not null default 0,
  unique (table_id, hand_no)
);

create index if not exists idx_online_hands_table_hand_no_desc
  on online_hands(table_id, hand_no desc);

create index if not exists idx_online_hands_active_last_action
  on online_hands(last_action_at, table_id)
  where state in ('preflop', 'flop', 'turn', 'river', 'showdown');

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
  manually_shown boolean not null default false,
  result_amount numeric not null default 0,
  unique (hand_id, seat_no)
);

alter table online_hand_players
  add column if not exists stat_vpip_recorded boolean not null default false;

alter table online_hand_players
  add column if not exists stat_pfr_recorded boolean not null default false;

alter table online_hand_players
  add column if not exists manually_shown boolean not null default false;

create index if not exists idx_online_hand_players_hand_group_player
  on online_hand_players(hand_id, group_player_id);

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

create index if not exists idx_online_actions_hand_actor_created_desc
  on online_actions(hand_id, actor_group_player_id, created_at desc)
  where status = 'accepted';

create table if not exists online_table_chat_messages (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references online_tables(id) on delete cascade,
  group_player_id uuid references group_players(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint online_table_chat_message_length
    check (char_length(btrim(message)) between 1 and 180)
);

create index if not exists idx_online_table_chat_messages_table_created
  on online_table_chat_messages(table_id, created_at desc);

create table if not exists online_table_voice_state (
  table_id uuid primary key references online_tables(id) on delete cascade,
  active_speaker_group_player_id uuid references group_players(id) on delete set null,
  floor_expires_at timestamptz,
  call_status text not null default 'idle',
  call_started_by_group_player_id uuid references group_players(id) on delete set null,
  call_started_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table online_table_voice_state
  add column if not exists call_status text;
alter table online_table_voice_state
  add column if not exists call_started_by_group_player_id uuid references group_players(id) on delete set null;
alter table online_table_voice_state
  add column if not exists call_started_at timestamptz;

update online_table_voice_state
set call_status = 'idle'
where call_status is null or btrim(call_status) = '';

alter table online_table_voice_state
  alter column call_status set default 'idle';
alter table online_table_voice_state
  alter column call_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'online_table_voice_state_call_status_check'
  ) then
    alter table online_table_voice_state
      add constraint online_table_voice_state_call_status_check
      check (call_status in ('idle','ringing','active'));
  end if;
end;
$$;

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

-- Viewer-safe state RPCs for client reads.
-- Runtime/settlement services should keep using online_get_hand_state for full cards.
drop function if exists online_get_hand_state_viewer(uuid, uuid, text, bigint);
create or replace function online_get_hand_state_viewer(
  p_hand_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

drop function if exists online_get_table_state_viewer(uuid, uuid, text, bigint);
drop function if exists online_get_table_chat_messages(uuid, uuid, text, int);
create or replace function online_get_table_chat_messages(
  p_table_id uuid,
  p_viewer_group_player_id uuid,
  p_viewer_seat_token text,
  p_limit int default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 40), 80));
  v_messages jsonb;
begin
  if coalesce(nullif(trim(p_viewer_seat_token), ''), '') = '' then
    return '[]'::jsonb;
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_viewer_group_player_id
    and s.left_at is null
    and s.seat_token = p_viewer_seat_token
  limit 1;

  if not found then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(row_to_json(msg_row) order by msg_row.at asc),
    '[]'::jsonb
  )
  into v_messages
  from (
    select
      m.id,
      m.table_id,
      m.group_player_id as player_id,
      gp.name,
      m.message as text,
      m.created_at as at
    from online_table_chat_messages m
    left join group_players gp on gp.id = m.group_player_id
    where m.table_id = p_table_id
    order by m.created_at desc
    limit v_limit
  ) msg_row;

  return v_messages;
end;
$$;

create or replace function online_get_table_state_viewer(
  p_table_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table jsonb;
  v_seats jsonb;
  v_hand_id uuid;
  v_hand_state jsonb := '{}'::jsonb;
  v_chat_messages jsonb := '[]'::jsonb;
  v_voice_state jsonb := '{}'::jsonb;
begin
  select to_jsonb(t) into v_table
  from online_tables t
  where t.id = p_table_id;

  if v_table is null then
    raise exception 'online_table_not_found';
  end if;

  select coalesce(
    jsonb_agg(
      ((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name))
      order by s.seat_no
    ),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id;

  select h.id
  into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state_viewer(
      v_hand_id,
      p_viewer_group_player_id,
      p_viewer_seat_token,
      p_since_seq
    );
  end if;

  v_chat_messages := online_get_table_chat_messages(
    p_table_id,
    p_viewer_group_player_id,
    p_viewer_seat_token,
    40
  );

  select coalesce(
    jsonb_build_object(
      'speaker_player_id', vs.active_speaker_group_player_id,
      'speaker_name', gp.name,
      'floor_expires_at', vs.floor_expires_at,
      'is_active', (vs.active_speaker_group_player_id is not null and coalesce(vs.floor_expires_at, now()) > now()),
      'call_status', coalesce(vs.call_status, 'idle'),
      'call_started_by_player_id', vs.call_started_by_group_player_id,
      'call_started_by_name', host_gp.name,
      'call_started_at', vs.call_started_at
    ),
    '{}'::jsonb
  )
  into v_voice_state
  from online_table_voice_state vs
  left join group_players gp on gp.id = vs.active_speaker_group_player_id
  left join group_players host_gp on host_gp.id = vs.call_started_by_group_player_id
  where vs.table_id = p_table_id;

  return jsonb_build_object(
    'table', v_table,
    'seats', coalesce(v_seats, '[]'::jsonb),
    'latest_hand', coalesce(v_hand_state, '{}'::jsonb),
    'chat_messages', coalesce(v_chat_messages, '[]'::jsonb),
    'voice_state', coalesce(v_voice_state, '{}'::jsonb)
  );
end;
$$;

-- Game-state-only viewer: no chat, no voice. Used on the hot path.
drop function if exists online_get_table_game_state_viewer(uuid, uuid, text, bigint);
create or replace function online_get_table_game_state_viewer(
  p_table_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
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

  select coalesce(
    jsonb_agg(
      ((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name))
      order by s.seat_no
    ),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
  where s.table_id = p_table_id;

  select h.id
  into v_hand_id
  from online_hands h
  where h.table_id = p_table_id
  order by h.hand_no desc
  limit 1;

  if v_hand_id is not null then
    v_hand_state := online_get_hand_state_viewer(
      v_hand_id,
      p_viewer_group_player_id,
      p_viewer_seat_token,
      p_since_seq
    );
  end if;

  return jsonb_build_object(
    'table', v_table,
    'seats', coalesce(v_seats, '[]'::jsonb),
    'latest_hand', coalesce(v_hand_state, '{}'::jsonb)
  );
end;
$$;

drop function if exists online_list_table_summaries(text[], int);
create or replace function online_list_table_summaries(
  p_statuses text[] default null,
  p_limit int default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with seat_counts as (
    select
      s.table_id,
      count(*)::int as seated_count
    from online_table_seats s
    where s.group_player_id is not null
      and s.left_at is null
    group by s.table_id
  ),
  settled_counts as (
    select
      h.table_id,
      count(*)::int as settled_hands
    from online_hands h
    where h.state = 'settled'
    group by h.table_id
  )
  select coalesce(
    jsonb_agg((to_jsonb(row_data) - 'sort_updated_at') order by row_data.sort_updated_at desc),
    '[]'::jsonb
  )
  from (
    select
      t.id,
      t.name,
      t.small_blind,
      t.big_blind,
      t.max_seats,
      t.starting_stack,
      t.status,
      t.created_at,
      t.updated_at,
      coalesce(seat_counts.seated_count, 0) as seated_count,
      coalesce(settled_counts.settled_hands, 0) as settled_hands,
      coalesce(t.updated_at, t.created_at) as sort_updated_at
    from online_tables t
    left join seat_counts on seat_counts.table_id = t.id
    left join settled_counts on settled_counts.table_id = t.id
    where coalesce(array_length(p_statuses, 1), 0) = 0
       or t.status = any(p_statuses)
    order by coalesce(t.updated_at, t.created_at) desc
    limit greatest(coalesce(p_limit, 50), 1)
  ) row_data;
$$;

drop function if exists online_get_table_results_summary(uuid);
create or replace function online_get_table_results_summary(
  p_table_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with target_table as (
    select
      t.id,
      t.name,
      t.small_blind,
      t.big_blind,
      t.max_seats,
      t.starting_stack,
      t.status,
      t.created_at,
      t.updated_at
    from online_tables t
    where t.id = p_table_id
  ),
  settled_hands as (
    select
      h.id,
      h.hand_no
    from online_hands h
    where h.table_id = p_table_id
      and h.state = 'settled'
  ),
  ordered_hp as (
    select
      hp.group_player_id,
      sh.hand_no,
      coalesce(hp.stack_start, 0)::numeric as stack_start,
      coalesce(hp.stack_end, 0)::numeric as stack_end,
      lag(coalesce(hp.stack_end, 0)::numeric) over (
        partition by hp.group_player_id
        order by sh.hand_no
      ) as prev_stack_end
    from online_hand_players hp
    join settled_hands sh on sh.id = hp.hand_id
    where hp.group_player_id is not null
  ),
  player_results as (
    select
      ohp.group_player_id,
      sum(
        case
          when ohp.prev_stack_end is null then ohp.stack_start
          when ohp.stack_start > coalesce(ohp.prev_stack_end, 0) then ohp.stack_start - coalesce(ohp.prev_stack_end, 0)
          else 0
        end
      ) as buy_in,
      (array_agg(ohp.stack_end order by ohp.hand_no desc))[1] as cash_out,
      count(*)::int as hands
    from ordered_hp ohp
    group by ohp.group_player_id
  ),
  players_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_player_id', pr.group_player_id,
          'name', coalesce(gp.name, 'Player'),
          'buy_in', online_normalize_money(pr.buy_in),
          'cash_out', online_normalize_money(pr.cash_out),
          'net', online_normalize_money(pr.cash_out - pr.buy_in),
          'hands', pr.hands
        )
        order by online_normalize_money(pr.cash_out - pr.buy_in) desc, coalesce(gp.name, 'Player') asc
      ),
      '[]'::jsonb
    ) as players
    from player_results pr
    left join group_players gp on gp.id = pr.group_player_id
  ),
  counts as (
    select count(*)::int as settled_hand_count
    from settled_hands
  )
  select
    case
      when exists(select 1 from target_table) then jsonb_build_object(
        'table', (select to_jsonb(t) from target_table t),
        'settled_hand_count', (select settled_hand_count from counts),
        'players', (select players from players_json)
      )
      else null
    end;
$$;

-- Rate limiting helpers
create or replace function online_check_action_rate_limit(
  p_hand_id uuid,
  p_actor_group_player_id uuid
)
returns void
language plpgsql
as $$
declare
  v_last_action_at timestamptz;
begin
  select max(a.created_at) into v_last_action_at
  from online_actions a
  where a.hand_id = p_hand_id
    and a.actor_group_player_id = p_actor_group_player_id
    and a.status = 'accepted';

  if v_last_action_at is not null
     and v_last_action_at > now() - interval '500 milliseconds'
  then
    raise exception 'action_rate_limited';
  end if;
end;
$$;

create or replace function online_check_join_rate_limit(
  p_table_id uuid,
  p_group_player_id uuid
)
returns void
language plpgsql
as $$
declare
  v_recent_join_at timestamptz;
begin
  select max(s.joined_at) into v_recent_join_at
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_group_player_id;

  if v_recent_join_at is not null
     and v_recent_join_at > now() - interval '5 seconds'
  then
    raise exception 'join_rate_limited';
  end if;
end;
$$;

create or replace function online_check_chat_rate_limit(
  p_table_id uuid,
  p_actor_group_player_id uuid
)
returns void
language plpgsql
as $$
declare
  v_recent_count int;
begin
  select count(*) into v_recent_count
  from online_table_chat_messages m
  where m.table_id = p_table_id
    and m.group_player_id = p_actor_group_player_id
    and m.created_at > now() - interval '1 second';

  if v_recent_count >= 1 then
    raise exception 'chat_rate_limited';
  end if;
end;
$$;

drop function if exists online_post_table_chat_message(uuid, uuid, text, text);
create or replace function online_post_table_chat_message(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_message text
)
returns jsonb
language plpgsql
as $$
declare
  v_trimmed text := left(btrim(coalesce(p_message, '')), 180);
  v_message_id uuid;
  v_created_at timestamptz;
  v_actor_name text;
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  if v_trimmed = '' then
    raise exception 'chat_message_required';
  end if;

  -- Rate limit: max 1 chat message per second per player
  perform online_check_chat_rate_limit(p_table_id, p_actor_group_player_id);

  perform 1
  from online_tables t
  where t.id = p_table_id;
  if not found then
    raise exception 'online_table_not_found';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  insert into online_table_chat_messages (
    table_id,
    group_player_id,
    message
  )
  values (
    p_table_id,
    p_actor_group_player_id,
    v_trimmed
  )
  returning id, created_at
  into v_message_id, v_created_at;

  select gp.name
  into v_actor_name
  from group_players gp
  where gp.id = p_actor_group_player_id;

  delete from online_table_chat_messages m
  where m.table_id = p_table_id
    and m.id in (
      select old_msg.id
      from online_table_chat_messages old_msg
      where old_msg.table_id = p_table_id
      order by old_msg.created_at desc
      offset 80
    );

  return jsonb_build_object(
    'id', v_message_id,
    'table_id', p_table_id,
    'player_id', p_actor_group_player_id,
    'name', coalesce(v_actor_name, 'Player'),
    'text', v_trimmed,
    'at', v_created_at
  );
end;
$$;

drop function if exists online_start_voice_call(uuid, uuid, text);
create or replace function online_start_voice_call(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_voice online_table_voice_state%rowtype;
  v_host_group_player_id uuid;
  v_actor_name text;
  v_now timestamptz := now();
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  select t.created_by_group_player_id
  into v_host_group_player_id
  from online_tables t
  where t.id = p_table_id;

  if v_host_group_player_id is null then
    raise exception 'online_table_not_found';
  end if;

  if v_host_group_player_id <> p_actor_group_player_id then
    raise exception 'host_only_voice_call_control';
  end if;

  insert into online_table_voice_state (
    table_id,
    call_status,
    call_started_by_group_player_id,
    call_started_at,
    active_speaker_group_player_id,
    floor_expires_at,
    updated_at
  )
  values (
    p_table_id,
    'active',
    p_actor_group_player_id,
    v_now,
    null,
    null,
    v_now
  )
  on conflict (table_id) do update
    set
      call_status = 'active',
      call_started_by_group_player_id = excluded.call_started_by_group_player_id,
      call_started_at = excluded.call_started_at,
      active_speaker_group_player_id = null,
      floor_expires_at = null,
      updated_at = v_now
  returning * into v_voice;

  select gp.name into v_actor_name
  from group_players gp
  where gp.id = p_actor_group_player_id;

  return jsonb_build_object(
    'ok', true,
    'call_status', v_voice.call_status,
    'call_started_by_player_id', v_voice.call_started_by_group_player_id,
    'call_started_by_name', coalesce(v_actor_name, 'Host'),
    'call_started_at', v_voice.call_started_at
  );
end;
$$;

drop function if exists online_end_voice_call(uuid, uuid, text);
create or replace function online_end_voice_call(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_voice online_table_voice_state%rowtype;
  v_host_group_player_id uuid;
  v_now timestamptz := now();
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  select t.created_by_group_player_id
  into v_host_group_player_id
  from online_tables t
  where t.id = p_table_id;

  if v_host_group_player_id is null then
    raise exception 'online_table_not_found';
  end if;

  if v_host_group_player_id <> p_actor_group_player_id then
    raise exception 'host_only_voice_call_control';
  end if;

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  update online_table_voice_state
  set
    call_status = 'idle',
    call_started_by_group_player_id = null,
    call_started_at = null,
    active_speaker_group_player_id = null,
    floor_expires_at = null,
    updated_at = v_now
  where table_id = p_table_id
  returning * into v_voice;

  return jsonb_build_object(
    'ok', true,
    'call_status', coalesce(v_voice.call_status, 'idle')
  );
end;
$$;

drop function if exists online_claim_voice_floor(uuid, uuid, text, int);
create or replace function online_claim_voice_floor(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_ttl_secs int default 6
)
returns jsonb
language plpgsql
as $$
declare
  v_ttl_secs int := greatest(3, least(coalesce(p_ttl_secs, 6), 15));
  v_floor online_table_voice_state%rowtype;
  v_current_name text;
  v_actor_name text;
  v_now timestamptz := now();
  v_current_active boolean := false;
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  select *
  into v_floor
  from online_table_voice_state
  where table_id = p_table_id
  for update;

  v_current_active := (
    v_floor.active_speaker_group_player_id is not null
    and coalesce(v_floor.floor_expires_at, v_now) > v_now
    and exists (
      select 1
      from online_table_seats s
      where s.table_id = p_table_id
        and s.group_player_id = v_floor.active_speaker_group_player_id
        and s.left_at is null
        and not coalesce(s.is_bot, false)
    )
  );

  if not v_current_active or v_floor.active_speaker_group_player_id = p_actor_group_player_id then
    update online_table_voice_state
    set
      active_speaker_group_player_id = p_actor_group_player_id,
      floor_expires_at = v_now + make_interval(secs => v_ttl_secs),
      updated_at = v_now
    where table_id = p_table_id
    returning * into v_floor;
    v_current_active := true;
  end if;

  select gp.name into v_current_name
  from group_players gp
  where gp.id = v_floor.active_speaker_group_player_id;

  select gp.name into v_actor_name
  from group_players gp
  where gp.id = p_actor_group_player_id;

  return jsonb_build_object(
    'granted', (v_floor.active_speaker_group_player_id = p_actor_group_player_id),
    'speaker_player_id', v_floor.active_speaker_group_player_id,
    'speaker_name', coalesce(v_current_name, v_actor_name, 'Player'),
    'floor_expires_at', v_floor.floor_expires_at,
    'is_active', v_current_active
  );
end;
$$;

drop function if exists online_refresh_voice_floor(uuid, uuid, text, int);
create or replace function online_refresh_voice_floor(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_ttl_secs int default 6
)
returns jsonb
language plpgsql
as $$
declare
  v_ttl_secs int := greatest(3, least(coalesce(p_ttl_secs, 6), 15));
  v_floor online_table_voice_state%rowtype;
  v_name text;
  v_now timestamptz := now();
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  update online_table_voice_state
  set
    floor_expires_at = v_now + make_interval(secs => v_ttl_secs),
    updated_at = v_now
  where table_id = p_table_id
    and active_speaker_group_player_id = p_actor_group_player_id
  returning * into v_floor;

  if not found then
    select *
    into v_floor
    from online_table_voice_state
    where table_id = p_table_id;
  end if;

  select gp.name into v_name
  from group_players gp
  where gp.id = v_floor.active_speaker_group_player_id;

  return jsonb_build_object(
    'granted', (v_floor.active_speaker_group_player_id = p_actor_group_player_id and coalesce(v_floor.floor_expires_at, v_now) > v_now),
    'speaker_player_id', v_floor.active_speaker_group_player_id,
    'speaker_name', coalesce(v_name, 'Player'),
    'floor_expires_at', v_floor.floor_expires_at,
    'is_active', (v_floor.active_speaker_group_player_id is not null and coalesce(v_floor.floor_expires_at, v_now) > v_now)
  );
end;
$$;

drop function if exists online_release_voice_floor(uuid, uuid, text);
create or replace function online_release_voice_floor(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text
)
returns jsonb
language plpgsql
as $$
declare
  v_floor online_table_voice_state%rowtype;
  v_name text;
  v_now timestamptz := now();
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'voice_access_requires_active_human_seat';
  end if;

  insert into online_table_voice_state (table_id)
  values (p_table_id)
  on conflict (table_id) do nothing;

  update online_table_voice_state
  set
    active_speaker_group_player_id = null,
    floor_expires_at = null,
    updated_at = v_now
  where table_id = p_table_id
    and active_speaker_group_player_id = p_actor_group_player_id
  returning * into v_floor;

  if not found then
    select *
    into v_floor
    from online_table_voice_state
    where table_id = p_table_id;
  end if;

  select gp.name into v_name
  from group_players gp
  where gp.id = v_floor.active_speaker_group_player_id;

  return jsonb_build_object(
    'released', true,
    'speaker_player_id', v_floor.active_speaker_group_player_id,
    'speaker_name', v_name,
    'floor_expires_at', v_floor.floor_expires_at,
    'is_active', false
  );
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

-- online_create_table and online_join_table are defined below with revamp params.

drop function if exists online_leave_table(uuid, uuid);
create or replace function online_leave_table(
  p_table_id uuid,
  p_group_player_id uuid,
  p_seat_token text
)
returns online_table_seats
language plpgsql
as $$
declare
  v_left online_table_seats%rowtype;
  v_active_count int;
  v_is_host boolean := false;
  v_new_host uuid;
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select (created_by_group_player_id = p_group_player_id) into v_is_host
  from online_tables
  where id = p_table_id;

  update online_table_seats
  set
    group_player_id = null,
    is_bot = false,
    is_sitting_out = false,
    seat_token = encode(gen_random_bytes(16), 'hex'),
    left_at = now()
  where table_id = p_table_id
    and group_player_id = p_group_player_id
    and left_at is null
    and seat_token = p_seat_token
  returning * into v_left;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_is_host then
    perform online_prune_bot_seats(p_table_id);
    select online_first_active_human_group_player(p_table_id) into v_new_host;
    update online_tables
    set created_by_group_player_id = v_new_host
    where id = p_table_id;
  end if;

  select count(*)
  into v_active_count
  from online_table_seats
  where table_id = p_table_id
    and group_player_id is not null
    and left_at is null;

  if v_active_count = 0 then
    update online_hands
    set state = 'canceled', ended_at = now(), action_seat = null
    where table_id = p_table_id
      and state not in ('settled', 'canceled');

    update online_tables
    set status = 'closed'
    where id = p_table_id
      and status in ('active', 'waiting');
  elsif v_active_count = 1 then
    -- With only 1 player left mid-hand, cancel the hand and award pot to remaining player
    declare
      v_active_hand_id uuid;
      v_last_seat int;
      v_pot numeric;
    begin
      select id, pot_total into v_active_hand_id, v_pot
      from online_hands
      where table_id = p_table_id
        and state not in ('settled', 'canceled')
      order by hand_no desc
      limit 1;

      if v_active_hand_id is not null then
        select seat_no into v_last_seat
        from online_hand_players
        where hand_id = v_active_hand_id
          and not folded
          and group_player_id is not null
          and group_player_id in (
            select group_player_id from online_table_seats
            where table_id = p_table_id and group_player_id is not null and left_at is null
          )
        limit 1;

        if v_last_seat is not null then
          update online_hand_players
          set result_amount = case when seat_no = v_last_seat then coalesce(v_pot, 0) else 0 end
          where hand_id = v_active_hand_id;

          update online_hand_players
          set stack_end = coalesce(stack_end, 0) + coalesce(v_pot, 0)
          where hand_id = v_active_hand_id and seat_no = v_last_seat;

          update online_table_seats s
          set chip_stack = hp.stack_end
          from online_hand_players hp
          where hp.hand_id = v_active_hand_id
            and s.table_id = p_table_id
            and s.seat_no = hp.seat_no
            and s.group_player_id = hp.group_player_id
            and s.left_at is null;
        end if;

        update online_hands
        set state = 'settled', ended_at = now(), action_seat = null
        where id = v_active_hand_id;
      end if;
    end;
  end if;

  return v_left;
end;
$$;

drop function if exists online_kick_table_player(uuid, uuid, text, uuid);
create or replace function online_kick_table_player(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_target_group_player_id uuid
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_target_seat online_table_seats%rowtype;
  v_left online_table_seats%rowtype;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  select * into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
    and seat_token = p_actor_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_only';
  end if;

  if p_target_group_player_id is null then
    raise exception 'target_player_required';
  end if;

  if p_target_group_player_id = p_actor_group_player_id then
    raise exception 'host_cannot_kick_self';
  end if;

  select * into v_target_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_target_group_player_id
    and left_at is null
  limit 1;

  if not found then
    raise exception 'target_player_not_seated';
  end if;

  select * into v_left
  from online_leave_table(
    p_table_id,
    p_target_group_player_id,
    v_target_seat.seat_token
  );

  return v_left;
end;
$$;

drop function if exists online_transfer_table_host(uuid, uuid, text, uuid);
create or replace function online_transfer_table_host(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_target_group_player_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_target_seat online_table_seats%rowtype;
  v_target_name text;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  select * into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
    and seat_token = p_actor_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_only';
  end if;

  if p_target_group_player_id is null then
    raise exception 'target_player_required';
  end if;

  select *
  into v_target_seat
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_target_group_player_id
    and s.left_at is null
  limit 1;

  if not found then
    raise exception 'target_player_not_seated';
  end if;

  select gp.name
  into v_target_name
  from group_players gp
  where gp.id = p_target_group_player_id;

  if coalesce(v_target_seat.is_bot, false) or coalesce(v_target_name, '') ilike 'Bot %' then
    raise exception 'host_transfer_requires_human_player';
  end if;

  update online_tables
  set created_by_group_player_id = p_target_group_player_id
  where id = p_table_id;

  return jsonb_build_object(
    'table_id', p_table_id,
    'host_group_player_id', p_target_group_player_id,
    'host_name', coalesce(v_target_name, 'Player')
  );
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
  add column if not exists deck_cards_encrypted text,
  add column if not exists current_bet numeric not null default 0,
  add column if not exists min_raise numeric not null default 0,
  add column if not exists action_seat int,
  add column if not exists last_action_at timestamptz default now(),
  add column if not exists turn_grace_used_secs int not null default 0;

alter table online_hand_players
  add column if not exists street_contribution numeric not null default 0,
  add column if not exists has_acted boolean not null default false;

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

create schema if not exists online_private;

create table if not exists online_private.runtime_dispatch_config (
  singleton boolean primary key default true check (singleton),
  supabase_anon_key text,
  dispatch_secret text,
  updated_at timestamptz not null default now()
);

revoke all on online_private.runtime_dispatch_config from public;
revoke all on online_private.runtime_dispatch_config from anon;
revoke all on online_private.runtime_dispatch_config from authenticated;

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

drop function if exists online_private.get_supabase_anon_key();
create or replace function online_private.get_supabase_anon_key()
returns text
language plpgsql
security definer
stable
set search_path = public, online_private, pg_temp
as $$
declare
  v_key text;
begin
  begin
    select rdc.supabase_anon_key
    into v_key
    from online_private.runtime_dispatch_config rdc
    where rdc.singleton = true;
  exception
    when undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') <> '' then
    return v_key;
  end if;

  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'SUPABASE_ANON_KEY'
      order by created_at desc
      limit 1
    $vault$
    into v_key;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') = '' then
    v_key := nullif(current_setting('app.settings.supabase_anon_key', true), '');
  end if;

  return v_key;
end;
$$;

drop function if exists online_private.get_runtime_dispatch_secret();
create or replace function online_private.get_runtime_dispatch_secret()
returns text
language plpgsql
security definer
stable
set search_path = public, online_private, pg_temp
as $$
declare
  v_key text;
begin
  begin
    select rdc.dispatch_secret
    into v_key
    from online_private.runtime_dispatch_config rdc
    where rdc.singleton = true;
  exception
    when undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') <> '' then
    return v_key;
  end if;

  begin
    execute $vault$
      select secret
      from vault.decrypted_secrets
      where name = 'ONLINE_RUNTIME_DISPATCH_SECRET'
      order by created_at desc
      limit 1
    $vault$
    into v_key;
  exception
    when invalid_schema_name or undefined_table or insufficient_privilege then
      v_key := null;
  end;

  if coalesce(v_key, '') = '' then
    v_key := nullif(current_setting('app.settings.online_runtime_dispatch_secret', true), '');
  end if;

  return v_key;
end;
$$;

drop function if exists online_set_runtime_dispatch_config(text, text);
create or replace function online_set_runtime_dispatch_config(
  p_supabase_anon_key text,
  p_dispatch_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_role text := coalesce(online_request_role(), '');
begin
  if v_role <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'service_role_required';
  end if;

  insert into online_private.runtime_dispatch_config as cfg (
    singleton,
    supabase_anon_key,
    dispatch_secret,
    updated_at
  )
  values (
    true,
    nullif(trim(coalesce(p_supabase_anon_key, '')), ''),
    nullif(trim(coalesce(p_dispatch_secret, '')), ''),
    now()
  )
  on conflict (singleton) do update
    set supabase_anon_key = excluded.supabase_anon_key,
        dispatch_secret = excluded.dispatch_secret,
        updated_at = now();

  return jsonb_build_object('ok', true);
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
grant execute on function online_private.get_supabase_anon_key() to anon, authenticated, service_role;
grant execute on function online_private.get_runtime_dispatch_secret() to anon, authenticated, service_role;
grant execute on function online_set_runtime_dispatch_config(text, text) to service_role;
grant execute on function online_private.pack_remaining_deck(jsonb) to anon, authenticated, service_role;
grant execute on function online_private.unpack_remaining_deck(jsonb, text) to anon, authenticated, service_role;

create or replace function online_normalize_money(
  p_value numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null then 0::numeric
    when abs(p_value) < 0.005 then 0::numeric
    else round(p_value::numeric, 2)
  end;
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
    and online_normalize_money(coalesce(stack_end, 0)) > 0;

  return online_next_active_seat(v_actionable_seats, p_after);
end;
$$;

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
    and not folded
    and not all_in
    and online_normalize_money(coalesce(stack_end, 0)) > 0;

  v_target_bet := online_normalize_money(v_target_bet);

  select count(*)
  into v_unsettled_count
  from online_hand_players
  where hand_id = p_hand_id
    and not folded
    and not all_in
    and (
      coalesce(has_acted, false) = false
      or online_normalize_money(coalesce(street_contribution, 0) - v_target_bet) <> 0
    );

  return v_unsettled_count = 0;
end;
$$;

drop function if exists online_request_role();
create or replace function online_request_role()
returns text
language plpgsql
stable
as $$
declare
  v_role text;
begin
  begin
    v_role := auth.role();
  exception when others then
    v_role := null;
  end;

  if coalesce(v_role, '') = '' then
    v_role := nullif(current_setting('request.jwt.claim.role', true), '');
  end if;

  if coalesce(v_role, '') = '' then
    begin
      v_role := nullif((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
    exception when others then
      v_role := null;
    end;
  end if;

  return v_role;
end;
$$;

drop function if exists online_runtime_processable_hands(uuid, int);
create or replace function online_runtime_processable_hands(
  p_table_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid,
  table_id uuid,
  state text,
  action_seat int,
  last_action_at timestamptz,
  decision_time_secs int
)
language sql
stable
as $$
  select
    h.id,
    h.table_id,
    h.state,
    h.action_seat,
    h.last_action_at,
    greatest(coalesce(t.decision_time_secs, 25), 10)::int as decision_time_secs
  from online_hands h
  join online_tables t on t.id = h.table_id
  where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
    and (p_table_id is null or h.table_id = p_table_id)
    and t.status <> 'closed'
  order by h.last_action_at asc nulls last
  limit greatest(coalesce(p_limit, 50), 1);
$$;

drop function if exists online_runtime_due_tables(int);
create or replace function online_runtime_due_tables(
  p_limit int default 24
)
returns table (
  table_id uuid
)
language sql
stable
as $$
  with latest_hand as (
    select distinct on (h.table_id)
      h.table_id,
      h.state,
      h.ended_at
    from online_hands h
    order by h.table_id, h.hand_no desc
  )
  select t.id as table_id
  from online_tables t
  join latest_hand lh on lh.table_id = t.id
  where t.status <> 'closed'
    and coalesce(t.auto_deal_enabled, true)
    and lh.state in ('settled', 'canceled')
    and coalesce(lh.ended_at, now()) <= now() - (
      make_interval(secs => greatest(coalesce(t.showdown_delay_secs, 5), 1) + 2)
      + interval '1160 milliseconds'
    )
    and not exists (
      select 1
      from online_hands active_hand
      where active_hand.table_id = t.id
        and active_hand.state not in ('settled', 'canceled')
    )
  order by lh.ended_at asc nulls last
  limit greatest(coalesce(p_limit, 24), 1);
$$;

drop function if exists online_runtime_health_check(int, int);
create or replace function online_runtime_health_check(
  p_limit int default 20,
  p_grace_secs int default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_role text := coalesce(online_request_role(), '');
  v_dispatch_ready boolean := false;
  v_processable_count int := 0;
  v_due_table_count int := 0;
  v_stale_hands jsonb := '[]'::jsonb;
begin
  if v_role <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'service_role_required';
  end if;

  v_dispatch_ready := coalesce(online_private.get_supabase_anon_key(), '') <> ''
    and coalesce(online_private.get_runtime_dispatch_secret(), '') <> '';

  select count(*)
  into v_processable_count
  from online_runtime_processable_hands(null, greatest(coalesce(p_limit, 20), 1));

  select count(*)
  into v_due_table_count
  from online_runtime_due_tables(greatest(coalesce(p_limit, 20), 1));

  with runtime_hands as (
    select
      h.id as hand_id,
      h.table_id,
      t.name as table_name,
      h.hand_no,
      h.state,
      h.action_seat,
      coalesce(h.last_action_at, h.started_at, now()) as anchor_at,
      case
        when h.state = 'showdown'
          then greatest(coalesce(t.showdown_delay_secs, 5), 1) + 2
        else greatest(coalesce(t.decision_time_secs, 25), 10)
      end as expected_secs
    from online_hands h
    join online_tables t on t.id = h.table_id
    where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
      and t.status <> 'closed'
  ),
  stale_candidates as (
    select
      rh.*,
      greatest(floor(extract(epoch from (now() - rh.anchor_at)))::int, 0) as age_secs
    from runtime_hands rh
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_id', sc.table_id,
        'table_name', sc.table_name,
        'hand_id', sc.hand_id,
        'hand_no', sc.hand_no,
        'state', sc.state,
        'action_seat', sc.action_seat,
        'age_secs', sc.age_secs,
        'expected_secs', sc.expected_secs,
        'grace_secs', greatest(coalesce(p_grace_secs, 15), 0),
        'seconds_overdue', greatest(sc.age_secs - sc.expected_secs - greatest(coalesce(p_grace_secs, 15), 0), 0),
        'reason', case
          when sc.state = 'showdown' then 'showdown_settlement_overdue'
          else 'turn_timeout_overdue'
        end
      )
      order by greatest(sc.age_secs - sc.expected_secs - greatest(coalesce(p_grace_secs, 15), 0), 0) desc, sc.anchor_at asc
    ),
    '[]'::jsonb
  )
  into v_stale_hands
  from (
    select *
    from stale_candidates
    where age_secs > expected_secs + greatest(coalesce(p_grace_secs, 15), 0)
    order by age_secs desc, anchor_at asc
    limit greatest(coalesce(p_limit, 20), 1)
  ) sc;

  return jsonb_build_object(
    'checked_at', now(),
    'dispatch_ready', v_dispatch_ready,
    'processable_count', v_processable_count,
    'due_table_count', v_due_table_count,
    'stale_hands', v_stale_hands
  );
end;
$$;

grant execute on function online_runtime_health_check(int, int) to service_role;

drop function if exists online_runtime_start_hand(uuid, text);
create or replace function online_runtime_start_hand(
  p_table_id uuid,
  p_note text default 'edge_runtime_auto_deal'
)
returns online_hands
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_actor_group_player_id uuid;
  v_actor_seat_token text;
  v_hand online_hands%rowtype;
begin
  if online_request_role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;

  select *
  into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  if online_active_human_host_group_player(p_table_id) is null then
    perform online_prune_bot_seats(p_table_id);
    update online_tables
    set created_by_group_player_id = online_first_active_human_group_player(p_table_id)
    where id = p_table_id
      and online_active_human_host_group_player(p_table_id) is null;
  end if;

  v_actor_group_player_id := coalesce(
    online_active_human_host_group_player(p_table_id),
    online_first_active_human_group_player(p_table_id)
  );

  if v_actor_group_player_id is null then
    raise exception 'runtime_no_active_human_host';
  end if;

  select s.seat_token
  into v_actor_seat_token
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = v_actor_group_player_id
    and s.left_at is null
  order by s.seat_no
  limit 1;

  if coalesce(v_actor_seat_token, '') = '' then
    raise exception 'runtime_host_seat_token_missing';
  end if;

  v_hand := online_start_hand(
    p_table_id,
    v_actor_group_player_id,
    v_actor_seat_token
  );

  perform online_append_hand_event(
    v_hand.id,
    p_table_id,
    'hand_auto_started',
    v_actor_group_player_id,
    jsonb_build_object('reason', coalesce(nullif(trim(p_note), ''), 'edge_runtime_auto_deal'))
  );

  return v_hand;
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
    -- Heads-up: dealer posts SB, other player posts BB
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
  -- Rate limit: max 1 action per actor per 500ms per hand
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

    v_sum_payouts := online_normalize_money(v_sum_payouts + online_normalize_money(v_payout.amount));
  end loop;

  if abs(v_sum_payouts - online_normalize_money(coalesce(v_hand.pot_total, 0))) > 0.01 then
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
      result_amount = online_normalize_money(v_payout.amount),
      stack_end = online_normalize_money(coalesce(stack_end, 0) + v_payout.amount)
    where hand_id = p_hand_id
      and seat_no = v_payout.seat_no;
  end loop;

  update online_hand_players
  set
    stack_end = online_normalize_money(coalesce(stack_end, 0)),
    committed = online_normalize_money(coalesce(committed, 0)),
    street_contribution = online_normalize_money(coalesce(street_contribution, 0)),
    result_amount = online_normalize_money(coalesce(result_amount, 0))
  where hand_id = p_hand_id;

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

drop function if exists online_set_hand_cards_visibility(uuid, uuid, text, boolean);
create or replace function online_set_hand_cards_visibility(
  p_hand_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_show boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_hand_player online_hand_players%rowtype;
  v_show boolean := coalesce(p_show, true);
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  if v_hand.state <> 'settled' then
    raise exception 'hand_not_settled';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = v_hand.table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  select * into v_hand_player
  from online_hand_players hp
  where hp.hand_id = p_hand_id
    and hp.group_player_id = p_actor_group_player_id
  limit 1;

  if not found then
    raise exception 'player_not_in_hand';
  end if;

  if jsonb_array_length(coalesce(v_hand_player.hole_cards, '[]'::jsonb)) < 2 then
    raise exception 'hole_cards_not_available';
  end if;

  if v_hand_player.manually_shown is distinct from v_show then
    update online_hand_players
    set manually_shown = v_show
    where id = v_hand_player.id
    returning * into v_hand_player;

    perform online_append_hand_event(
      p_hand_id,
      v_hand.table_id,
      'cards_visibility_changed',
      p_actor_group_player_id,
      jsonb_build_object(
        'seat_no', v_hand_player.seat_no,
        'shown', v_show
      )
    );

    perform online_write_hand_snapshot(p_hand_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'seat_no', v_hand_player.seat_no,
    'shown', coalesce(v_hand_player.manually_shown, v_show)
  );
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

  select coalesce(
    jsonb_agg(
      ((to_jsonb(s) - 'seat_token') || jsonb_build_object('player_name', gp.name))
      order by s.seat_no
    ),
    '[]'::jsonb
  )
  into v_seats
  from online_table_seats s
  left join group_players gp on gp.id = s.group_player_id
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

drop function if exists online_advance_hand(uuid, uuid, text);
drop function if exists online_advance_hand(uuid, uuid, text, text);
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

  -- Only host can force-advance a hand manually.
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
    -- Real table dealing: burn one card before every board reveal.
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

-- ---------- Online Poker Revamp: Standalone Play ----------

alter table online_tables
  add column if not exists starting_stack numeric not null default 200;

alter table online_tables
  add column if not exists chip_mode text not null default 'play_money';

alter table online_tables
  add column if not exists auto_deal_enabled boolean not null default true;

alter table online_tables
  add column if not exists showdown_delay_secs int not null default 5;

alter table online_tables
  add column if not exists decision_time_secs int not null default 25;

-- Standalone lobby identity: auto-creates a hidden system group + player by name.
create or replace function online_ensure_lobby_player(p_name text)
returns jsonb
language plpgsql
as $$
declare
  v_normalized text;
  v_group_id uuid;
  v_player_id uuid;
  v_player_name text;
begin
  v_normalized := lower(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  if v_normalized = '' then
    raise exception 'name_required';
  end if;

  select id into v_group_id
  from groups
  where name = '__online_lobby__'
  limit 1;

  if v_group_id is null then
    insert into groups(name)
    values ('__online_lobby__')
    returning id into v_group_id;
  end if;

  select id, name into v_player_id, v_player_name
  from group_players
  where group_id = v_group_id
    and normalized_name = v_normalized
    and archived_at is null
  limit 1;

  if v_player_id is null then
    insert into group_players(group_id, name, normalized_name)
    values (v_group_id, trim(p_name), v_normalized)
    returning id, name into v_player_id, v_player_name;
  end if;

  return jsonb_build_object(
    'group_id', v_group_id,
    'group_player_id', v_player_id,
    'name', v_player_name
  );
end;
$$;

-- Rebuy chips between hands.
create or replace function online_rebuy_chips(
  p_table_id uuid,
  p_group_player_id uuid,
  p_seat_token text,
  p_amount numeric default null
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_seat online_table_seats%rowtype;
  v_active_hand_id uuid;
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

  update online_table_seats
  set chip_stack = chip_stack + coalesce(p_amount, v_table.starting_stack)
  where id = v_seat.id
  returning * into v_seat;

  return v_seat;
end;
$$;

drop function if exists online_update_table_settings(uuid, uuid, text, numeric, numeric, boolean, int, int);
create or replace function online_update_table_settings(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_small_blind numeric default null,
  p_big_blind numeric default null,
  p_auto_deal_enabled boolean default null,
  p_showdown_delay_secs int default null,
  p_decision_time_secs int default null
)
returns online_tables
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_small_blind numeric;
  v_big_blind numeric;
  v_auto_deal_enabled boolean;
  v_showdown_delay_secs int;
  v_decision_time_secs int;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select *
  into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_required_to_update_table_settings';
  end if;

  select *
  into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
  order by seat_no
  limit 1;

  if not found then
    raise exception 'host_not_seated';
  end if;

  if v_actor_seat.seat_token is distinct from p_actor_seat_token then
    raise exception 'host_seat_token_invalid';
  end if;

  v_small_blind := greatest(coalesce(p_small_blind, v_table.small_blind), 0);
  v_big_blind := greatest(coalesce(p_big_blind, v_table.big_blind), 0);
  v_auto_deal_enabled := coalesce(p_auto_deal_enabled, v_table.auto_deal_enabled);
  v_showdown_delay_secs := coalesce(p_showdown_delay_secs, v_table.showdown_delay_secs);
  v_decision_time_secs := coalesce(p_decision_time_secs, v_table.decision_time_secs);

  if v_small_blind <= 0 or v_big_blind <= 0 then
    raise exception 'invalid_blinds';
  end if;

  if v_big_blind < v_small_blind then
    raise exception 'small_blind_cannot_exceed_big_blind';
  end if;

  if v_showdown_delay_secs not in (3, 5, 9) then
    raise exception 'showdown_delay_out_of_range';
  end if;

  if v_decision_time_secs < 10 or v_decision_time_secs > 120 then
    raise exception 'decision_time_out_of_range';
  end if;

  update online_tables
  set
    small_blind = v_small_blind,
    big_blind = v_big_blind,
    auto_deal_enabled = v_auto_deal_enabled,
    showdown_delay_secs = v_showdown_delay_secs,
    decision_time_secs = v_decision_time_secs
  where id = p_table_id
  returning * into v_table;

  return v_table;
end;
$$;

drop function if exists online_update_player_preferences(uuid, uuid, text, boolean);
create or replace function online_update_player_preferences(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_auto_check_when_available boolean default null
)
returns online_table_seats
language plpgsql
as $$
declare
  v_seat online_table_seats%rowtype;
begin
  if p_table_id is null then
    raise exception 'table_id_required';
  end if;
  if p_actor_group_player_id is null then
    raise exception 'actor_required';
  end if;
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select *
  into v_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
  order by seat_no
  limit 1
  for update;

  if not found then
    raise exception 'player_not_seated';
  end if;

  if v_seat.seat_token is distinct from p_actor_seat_token then
    raise exception 'seat_token_invalid';
  end if;

  update online_table_seats
  set
    auto_check_when_available = coalesce(p_auto_check_when_available, auto_check_when_available)
  where id = v_seat.id
  returning * into v_seat;

  return v_seat;
end;
$$;

drop function if exists online_request_turn_grace(uuid, uuid, text, int);
create or replace function online_request_turn_grace(
  p_hand_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_grace_secs int default 3
)
returns online_hands
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_table online_tables%rowtype;
  v_hand_player online_hand_players%rowtype;
  v_active_seat online_table_seats%rowtype;
  v_requested_secs int := greatest(1, least(coalesce(p_grace_secs, 3), 3));
  v_granted_secs int := 0;
  v_remaining_secs numeric := 0;
begin
  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  if p_actor_group_player_id is null then
    raise exception 'actor_required';
  end if;

  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
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

  if v_active_seat.seat_token is distinct from p_actor_seat_token then
    raise exception 'seat_token_invalid';
  end if;

  if v_hand.state not in ('preflop', 'flop', 'turn', 'river')
     or v_hand.action_seat is null then
    return v_hand;
  end if;

  select *
  into v_hand_player
  from online_hand_players
  where hand_id = p_hand_id
    and group_player_id = p_actor_group_player_id
  limit 1;

  if not found then
    raise exception 'actor_not_in_hand';
  end if;

  if v_hand_player.seat_no <> v_hand.action_seat
     or v_hand_player.folded
     or v_hand_player.all_in
     or coalesce(v_hand_player.stack_end, 0) <= 0 then
    return v_hand;
  end if;

  select *
  into v_table
  from online_tables
  where id = v_hand.table_id;

  v_remaining_secs := greatest(
    0,
    coalesce(v_table.decision_time_secs, 25)
    - floor(extract(epoch from greatest(interval '0 second', now() - coalesce(v_hand.last_action_at, now()))))
  );

  if v_remaining_secs > 4 then
    return v_hand;
  end if;

  v_granted_secs := least(
    v_requested_secs,
    greatest(0, 6 - coalesce(v_hand.turn_grace_used_secs, 0))
  );

  if v_granted_secs <= 0 then
    return v_hand;
  end if;

  update online_hands
  set
    last_action_at = coalesce(last_action_at, now()) + make_interval(secs => v_granted_secs),
    turn_grace_used_secs = coalesce(turn_grace_used_secs, 0) + v_granted_secs
  where id = p_hand_id
  returning * into v_hand;

  return v_hand;
end;
$$;

-- Updated online_create_table with starting_stack and chip_mode params.
drop function if exists online_create_table(uuid, text, uuid, text, text, numeric, numeric, int);
create or replace function online_create_table(
  p_group_id uuid,
  p_name text,
  p_created_by_group_player_id uuid default null,
  p_variant text default 'nlhe',
  p_betting_structure text default 'no_limit',
  p_small_blind numeric default 1,
  p_big_blind numeric default 2,
  p_max_seats int default 6,
  p_starting_stack numeric default 200,
  p_chip_mode text default 'play_money'
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
    created_by_group_player_id,
    starting_stack,
    chip_mode
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
    p_created_by_group_player_id,
    greatest(coalesce(p_starting_stack, 200), 1),
    coalesce(p_chip_mode, 'play_money')
  )
  returning * into v_table;

  insert into online_table_seats(table_id, seat_no, chip_stack)
  select v_table.id, gs, 0
  from generate_series(1, v_table.max_seats) as gs
  on conflict (table_id, seat_no) do nothing;

  return v_table;
end;
$$;

-- Updated online_join_table: uses table starting_stack when chip_stack not provided.
drop function if exists online_claim_table_seat(uuid, uuid);
create or replace function online_claim_table_seat(
  p_table_id uuid,
  p_group_player_id uuid
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_seat online_table_seats%rowtype;
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

  update online_table_seats
  set
    seat_token = encode(gen_random_bytes(16), 'hex'),
    joined_at = now()
  where id in (
    select id
    from online_table_seats
    where table_id = p_table_id
      and group_player_id = p_group_player_id
      and left_at is null
    for update
    limit 1
  )
  returning * into v_seat;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  return v_seat;
end;
$$;

drop function if exists online_join_table(uuid, uuid, int, numeric);
drop function if exists online_join_table(uuid, uuid, int, numeric, text);
drop function if exists online_join_table(uuid, uuid, int, numeric, text, boolean);
drop function if exists online_join_table(uuid, uuid, int, numeric, text, boolean, text);
create or replace function online_join_table(
  p_table_id uuid,
  p_group_player_id uuid,
  p_preferred_seat int default null,
  p_chip_stack numeric default null,
  p_seat_token text default null,
  p_is_bot boolean default false,
  p_bot_personality text default null
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_existing online_table_seats%rowtype;
  v_joined online_table_seats%rowtype;
  v_stack numeric;
begin
  -- Rate limit: max 1 join per player per table per 5 seconds (skip for bots)
  if not coalesce(p_is_bot, false) then
    perform online_check_join_rate_limit(p_table_id, p_group_player_id);
  end if;

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

  v_stack := coalesce(p_chip_stack, v_table.starting_stack, 200);

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
    if coalesce(nullif(trim(p_seat_token), ''), '') <> '' and p_seat_token = v_existing.seat_token then
      return v_existing;
    end if;
    raise exception 'player_already_seated_claim_required';
  end if;

  if p_preferred_seat is not null then
    if p_preferred_seat < 1 or p_preferred_seat > v_table.max_seats then
      raise exception 'preferred_seat_out_of_range';
    end if;

    update online_table_seats
    set
      group_player_id = p_group_player_id,
      chip_stack = greatest(v_stack, 0),
      is_bot = coalesce(p_is_bot, false),
      bot_personality = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_personality), '') else null end,
      bot_rebuy_count = case when coalesce(p_is_bot, false) then 0 else 0 end,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
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
      chip_stack = greatest(v_stack, 0),
      is_bot = coalesce(p_is_bot, false),
      bot_personality = case when coalesce(p_is_bot, false) then nullif(trim(p_bot_personality), '') else null end,
      bot_rebuy_count = case when coalesce(p_is_bot, false) then 0 else 0 end,
      is_sitting_out = false,
      seat_token = coalesce(nullif(trim(p_seat_token), ''), encode(gen_random_bytes(16), 'hex')),
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

  if not coalesce(p_is_bot, false)
     and online_active_human_host_group_player(p_table_id) is null
  then
    perform online_prune_bot_seats(p_table_id);
    update online_tables
    set created_by_group_player_id = online_first_active_human_group_player(p_table_id)
    where id = p_table_id
      and online_active_human_host_group_player(p_table_id) is null;
  end if;

  return v_joined;
end;
$$;

create extension if not exists pg_net;
create extension if not exists pg_cron;

drop function if exists online_dispatch_edge_runtime();
create or replace function online_dispatch_edge_runtime()
returns bigint
language plpgsql
as $dispatch$
declare
  v_request_id bigint;
  v_should_run boolean := false;
  v_anon_key text;
  v_dispatch_secret text;
begin
  if coalesce(online_request_role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
  then
    return null;
  end if;

  select
    exists(
      select 1
      from online_hands h
      join online_tables t on t.id = h.table_id
      where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
        and t.status <> 'closed'
    )
    or exists(select 1 from online_runtime_due_tables(1))
  into v_should_run;

  if not coalesce(v_should_run, false) then
    return null;
  end if;

  v_anon_key := online_private.get_supabase_anon_key();
  if coalesce(v_anon_key, '') = '' then
    raise exception 'supabase_anon_key_not_configured';
  end if;

  v_dispatch_secret := online_private.get_runtime_dispatch_secret();
  if coalesce(v_dispatch_secret, '') = '' then
    raise exception 'online_runtime_dispatch_secret_not_configured';
  end if;

  select net.http_post(
    url := 'https://xngwmtwrruvbrlxhekxp.supabase.co/functions/v1/online-runtime-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key,
      'x-online-runtime-secret', v_dispatch_secret
    ),
    body := jsonb_build_object(
      'limit', 48,
      'max_advance_per_hand', 4,
      'settle_note', 'edge_runtime_auto_showdown'
    )
  )
  into v_request_id;

  return v_request_id;
end;
$dispatch$;

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'online-runtime-dispatch'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'online-runtime-dispatch',
    '2 seconds',
    $job$select online_dispatch_edge_runtime();$job$
  );
end
$cron$;

-- ============================================================
-- Phase 1: Immediate continuation path
-- ============================================================

-- 1a. Read-only status function: what follow-up does this hand need?
drop function if exists online_post_action_continuation(uuid);
create or replace function online_post_action_continuation(
  p_hand_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'hand_id', h.id,
    'table_id', h.table_id,
    'state', h.state,
    'action_seat', h.action_seat,
    'needs_showdown', (h.state = 'showdown'),
    'needs_allin_runout', (
      h.state in ('preflop','flop','turn','river')
      and not exists(
        select 1 from online_hand_players hp
        where hp.hand_id = h.id
          and not hp.folded
          and not hp.all_in
          and hp.stack_end is not null
          and online_normalize_money(hp.stack_end) > 0
      )
    ),
    'next_actor_is_bot', (
      h.action_seat is not null
      and exists(
        select 1 from online_table_seats s
        where s.table_id = h.table_id
          and s.seat_no = h.action_seat
          and s.is_bot = true
          and s.left_at is null
      )
    )
  )
  from online_hands h
  where h.id = p_hand_id;
$$;

-- 1b. Client-callable continuation RPC.
-- Advances all-in runouts inline, then triggers targeted runtime nudge
-- (server-to-server via pg_net) for bot actions and showdown settlement.
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
  -- Validate hand exists
  select * into v_hand
  from online_hands
  where id = p_hand_id;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  v_table_id := v_hand.table_id;

  -- Validate caller is seated at this table with matching token
  select * into v_seat_row
  from online_table_seats
  where table_id = v_table_id
    and group_player_id = p_actor_group_player_id
    and seat_token = p_seat_token
    and left_at is null;

  if not found then
    raise exception 'online_continue_hand_not_seated';
  end if;

  -- Use an advisory xact lock so only one continuation path can process
  -- a table at a time without generating extra hand-event writes.
  if not pg_try_advisory_xact_lock(hashtext('online_continue_hand'), hashtext(v_table_id::text)) then
    return jsonb_build_object(
      'continued', false,
      'triggered_runtime', false,
      'final_state', v_hand.state,
      'reason', 'rate_limited'
    );
  end if;

  -- Check what continuation is needed
  v_cont := online_post_action_continuation(p_hand_id);

  -- If hand is already settled or canceled, nothing to do
  if v_hand.state in ('settled', 'canceled') then
    return jsonb_build_object(
      'continued', false,
      'triggered_runtime', false,
      'final_state', v_hand.state,
      'reason', 'hand_complete'
    );
  end if;

  -- Handle all-in runout: advance streets inline until showdown or actionable seat
  if (v_cont->>'needs_allin_runout')::boolean then
    while v_advance_count < v_max_advances loop
      -- Re-read hand state
      select * into v_hand
      from online_hands
      where id = p_hand_id;

      -- Stop if we hit showdown, settled, or a non-street state
      if v_hand.state not in ('preflop','flop','turn','river') then
        exit;
      end if;

      -- Stop if there is an actionable (non-allin, non-folded) player
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

    -- Re-read state after advances
    select * into v_hand from online_hands where id = p_hand_id;
    v_cont := online_post_action_continuation(p_hand_id);
  end if;

  -- Trigger targeted runtime nudge for showdown settlement or bot action
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

  -- Re-read final state
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

-- 1d. Modify processable hands to skip recently-continued hands
drop function if exists online_runtime_processable_hands(uuid, int);
create or replace function online_runtime_processable_hands(
  p_table_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid,
  table_id uuid,
  state text,
  action_seat int,
  last_action_at timestamptz,
  decision_time_secs int
)
language sql
stable
as $$
  select
    h.id,
    h.table_id,
    h.state,
    h.action_seat,
    h.last_action_at,
    greatest(coalesce(t.decision_time_secs, 25), 10)::int as decision_time_secs
  from online_hands h
  join online_tables t on t.id = h.table_id
  where h.state in ('preflop', 'flop', 'turn', 'river', 'showdown')
    and (p_table_id is null or h.table_id = p_table_id)
    and t.status <> 'closed'
    -- Skip hands that were just acted on (continuation path handles them)
    and (h.last_action_at is null or h.last_action_at <= now() - interval '3 seconds')
  order by h.last_action_at asc nulls last
  limit greatest(coalesce(p_limit, 50), 1);
$$;
