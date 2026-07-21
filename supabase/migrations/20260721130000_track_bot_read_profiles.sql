-- Track behavioral read-profiles for BOTS too, not just humans.
--
-- Until now the stat-recording gate (online_bot_profile_is_human) excluded any
-- bot seat, so bots had no recorded VPIP/PFR/aggression/showdown history. Two
-- features need that history:
--   * bot-vs-bot reads -- a bot reading its opponents now gets real data on the
--     other bots instead of a low-confidence default;
--   * table image -- a bot can see how the field currently reads IT (aggressive,
--     nitty, caught bluffing) and adjust.
--
-- online_bot_profile_is_human is called ONLY by the four recording gates
-- (ensure / record_hand_start / record_action / record_hand_completion), and
-- online_get_bot_opponent_profiles has its own inline human-only filter, so this
-- is a two-function change: make the predicate trackable-for-everyone, and let
-- the profiles RPC return bot rows. The predicate keeps its name to avoid
-- rewriting its four callers.

create or replace function online_bot_profile_is_human(
  p_table_id uuid,
  p_group_player_id uuid
)
returns boolean
language sql
stable
as $$
  -- Despite the legacy name, this now means "a trackable seated player" -- any
  -- real (non-archived) group player, humans AND bots. Bots used to be excluded
  -- here; they are recorded now.
  select exists (
    select 1
    from group_players gp
    where gp.id = p_group_player_id
      and gp.archived_at is null
  );
$$;

create or replace function online_get_bot_opponent_profiles(
  p_table_id uuid
)
returns jsonb
language sql
stable
as $$
  -- Now returns every seated player's profile (bots included) so a deciding bot
  -- can read the other bots AND pull its own row for table image. The runtime
  -- matches rows to seats by group_player_id, so including extra rows is safe.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_player_id', s.group_player_id,
        'seat_no', s.seat_no,
        'player_name', gp.name,
        'chip_stack', s.chip_stack,
        'is_bot', coalesce(s.is_bot, false),
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
    and s.left_at is null;
$$;
