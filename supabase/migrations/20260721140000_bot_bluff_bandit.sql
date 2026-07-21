-- Outcome-tuned bluff-frequency bandit for bots.
--
-- Learning from raw hand profit is hopeless in poker -- the variance drowns the
-- signal. Instead we learn from an immediate, low-variance outcome: when a bot
-- fires a bluff, did it actually take the pot down WITHOUT a showdown (folded the
-- table out = success) or get called to a showdown (fail)? Aggregated per bot per
-- street, that success rate says whether this table is foldy (bluff more here) or
-- sticky (stop spewing). The engine only NUDGES its bluff frequency from it, and
-- counts decay, so it adapts and can never swing wildly.

-- Per-bot, per-bucket (street) running tally.
create table if not exists online_bot_bandit_stats (
  group_player_id uuid not null references group_players(id) on delete cascade,
  bucket text not null,
  attempts int not null default 0,
  successes int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (group_player_id, bucket)
);
-- Only the service-role runtime touches these; RLS on (no policies) locks out anon/auth.
alter table online_bot_bandit_stats enable row level security;

-- Bluffs fired this hand, awaiting resolution at settle.
create table if not exists online_bot_bandit_pending (
  hand_id uuid not null references online_hands(id) on delete cascade,
  group_player_id uuid not null references group_players(id) on delete cascade,
  bucket text not null,
  created_at timestamptz not null default now(),
  primary key (hand_id, group_player_id, bucket)
);
alter table online_bot_bandit_pending enable row level security;

-- Runtime calls this the moment a bot fires a bluff.
create or replace function online_bot_bandit_record(
  p_hand_id uuid,
  p_group_player_id uuid,
  p_bucket text
)
returns void
language sql
as $$
  insert into online_bot_bandit_pending(hand_id, group_player_id, bucket)
  values (p_hand_id, p_group_player_id, p_bucket)
  on conflict (hand_id, group_player_id, bucket) do nothing;
$$;

-- At settle: resolve every pending bluff for the hand. Success = the bluffer won
-- it without a showdown (exactly one unfolded player left -- them -- with a
-- positive result). Then fold the tallies in, decay large counts so old reads
-- fade, and clear the pending rows.
create or replace function online_bot_bandit_settle(
  p_hand_id uuid
)
returns void
language plpgsql
as $$
declare
  v_live int;
  r record;
  v_success boolean;
begin
  select count(*) into v_live
  from online_hand_players
  where hand_id = p_hand_id and not folded;

  for r in
    select group_player_id, bucket
    from online_bot_bandit_pending
    where hand_id = p_hand_id
  loop
    select (v_live = 1 and not hp.folded and coalesce(hp.result_amount, 0) > 0)
      into v_success
    from online_hand_players hp
    where hp.hand_id = p_hand_id and hp.group_player_id = r.group_player_id
    limit 1;

    insert into online_bot_bandit_stats(group_player_id, bucket, attempts, successes, updated_at)
    values (r.group_player_id, r.bucket, 1, case when coalesce(v_success, false) then 1 else 0 end, now())
    on conflict (group_player_id, bucket) do update
      set attempts = online_bot_bandit_stats.attempts + 1,
          successes = online_bot_bandit_stats.successes + case when coalesce(v_success, false) then 1 else 0 end,
          updated_at = now();
  end loop;

  delete from online_bot_bandit_pending where hand_id = p_hand_id;

  -- Keep the window rolling: once a bucket has plenty of data, decay it so the
  -- bot keeps tracking the current table rather than ancient history.
  update online_bot_bandit_stats
    set attempts = (attempts * 3) / 4,
        successes = (successes * 3) / 4
    where attempts > 40;
end;
$$;

-- Getter: bluff tallies for every bot currently seated at a table, keyed
-- "<group_player_id>|<bucket>".
create or replace function online_bot_bandit_get(
  p_table_id uuid
)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from (
    select s.group_player_id::text || '|' || s.bucket as k,
           jsonb_build_object('attempts', s.attempts, 'successes', s.successes) as v
    from online_bot_bandit_stats s
    join online_table_seats seat
      on seat.group_player_id = s.group_player_id
     and seat.table_id = p_table_id
     and seat.left_at is null
  ) t;
$$;

grant execute on function online_bot_bandit_record(uuid, uuid, text) to service_role;
grant execute on function online_bot_bandit_settle(uuid) to service_role;
grant execute on function online_bot_bandit_get(uuid) to service_role;
