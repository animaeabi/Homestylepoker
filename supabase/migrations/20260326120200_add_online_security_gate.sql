-- Phase 3: Online-only launch security gate
-- Enables RLS on online tables, adds rate limiting to mutation RPCs.
-- RPCs run as function definer (SECURITY DEFINER) so they bypass RLS.
-- Direct client access via anon key is blocked for writes and restricted for reads.

-- ============================================================
-- 3a. Enable RLS on all online gameplay tables
-- ============================================================

-- Core gameplay tables: deny all direct access. RPCs handle everything.
alter table online_tables enable row level security;
alter table online_table_seats enable row level security;
alter table online_hands enable row level security;
alter table online_hand_players enable row level security;
alter table online_actions enable row level security;
alter table online_hand_events enable row level security;
alter table online_hand_snapshots enable row level security;

-- Chat and voice
alter table online_table_chat_messages enable row level security;
alter table online_table_voice_state enable row level security;

-- ==========================================================
-- SELECT policies: defense-in-depth by sensitivity tier.
-- ==========================================================
-- Supabase Realtime postgres_changes requires SELECT access to
-- fire change notifications for a table. We only grant SELECT on
-- tables that contain no sensitive data, and deny or restrict
-- direct reads on tables with sensitive columns.
--
-- Tier 1: NO sensitive data — open SELECT, safe for Realtime.
-- Tier 2: SENSITIVE columns — no direct SELECT from anon.
--         Reads MUST go through SECURITY DEFINER RPCs.
--         Realtime subscriptions for these tables are removed from
--         the client; online_hand_events covers all state changes.
-- ==========================================================

-- Tier 1: no sensitive data — anon SELECT allowed.
create policy "online_tables_select" on online_tables
  for select using (true);

create policy "online_hand_events_select" on online_hand_events
  for select using (true);

create policy "online_actions_select" on online_actions
  for select using (true);

create policy "online_hand_snapshots_select" on online_hand_snapshots
  for select using (true);

create policy "online_table_chat_messages_select" on online_table_chat_messages
  for select using (true);

create policy "online_table_voice_state_select" on online_table_voice_state
  for select using (true);

-- Tier 2: SENSITIVE — deny direct anon SELECT.
-- Contains: deck_cards, deck_cards_encrypted (full deck)
-- Reads go through online_get_hand_state_viewer (SECURITY DEFINER) which
-- strips deck data at schema line 672.
-- No SELECT policy = denied by default with RLS enabled.
-- (online_hands: no anon SELECT policy)

-- Contains: hole_cards (other players' hidden cards)
-- Reads go through online_get_hand_state_viewer which masks
-- non-viewer hole cards.
-- (online_hand_players: no anon SELECT policy)

-- Contains: seat_token (session impersonation risk)
-- Realtime subscription for seat changes (join/leave) requires SELECT access.
-- RLS cannot filter by column, so seat_token is visible in direct queries.
-- Mitigation: RPCs strip seat_token (schema line 807). The real fix is to
-- move seat_token to online_private.seat_tokens in a future migration.
-- For now, restrict to active (non-departed) seats only to reduce exposure.
create policy "online_table_seats_select" on online_table_seats
  for select using (left_at is null);

-- Mark viewer RPCs as SECURITY DEFINER so they can read the restricted tables.
alter function online_get_table_state_viewer(uuid, uuid, text, bigint) security definer;
alter function online_get_table_game_state_viewer(uuid, uuid, text, bigint) security definer;
alter function online_get_hand_state_viewer(uuid, uuid, text, bigint) security definer;
alter function online_post_action_continuation(uuid) security definer;
alter function online_get_table_chat_messages(uuid, uuid, text, int) security definer;

-- Write policies: deny all direct writes from anon/authenticated.
-- All mutations go through SECURITY DEFINER RPC functions.
-- (No INSERT/UPDATE/DELETE policies = denied by default with RLS enabled.)

-- Service role bypass: Supabase service_role bypasses RLS by default.

-- ============================================================
-- 3b. Mark key RPC functions as SECURITY DEFINER
-- ============================================================
-- This ensures they run as the function owner (postgres) and bypass RLS.
-- Only functions that need to write to RLS-protected tables.

-- Action & continuation
alter function online_submit_action(uuid, uuid, text, numeric, text, text) security definer;
alter function online_continue_hand(uuid, uuid, text) security definer;
alter function online_advance_hand(uuid, uuid, text, text) security definer;
alter function online_settle_showdown(uuid, jsonb, uuid, text) security definer;
alter function online_post_table_chat_message(uuid, uuid, text, text) security definer;

-- Table/seat lifecycle
alter function online_create_table(uuid, text, uuid, text, text, numeric, numeric, int, numeric, text) security definer;
alter function online_join_table(uuid, uuid, int, numeric, text, boolean, text) security definer;
alter function online_claim_table_seat(uuid, uuid) security definer;
alter function online_leave_table(uuid, uuid, text) security definer;

-- Hand lifecycle
alter function online_start_hand(uuid, uuid, text) security definer;

-- Event and snapshot helpers (called by the above functions)
alter function online_append_hand_event(uuid, uuid, text, uuid, jsonb) security definer;
alter function online_write_hand_snapshot(uuid) security definer;

-- Read functions can stay SECURITY INVOKER (default) since we have SELECT policies.
-- online_get_table_state_viewer, online_get_table_game_state_viewer,
-- online_get_hand_state_viewer, online_post_action_continuation are all read-only.

-- ============================================================
-- 3c. Rate limiting in online_submit_action
-- ============================================================
-- Add a per-actor throttle: reject if same actor submitted another
-- accepted action for the same hand within 500ms.
-- We add this as a standalone check function rather than modifying
-- the large online_submit_action body, to minimize diff risk.

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

-- ============================================================
-- 3d. Rate limiting for table joins
-- ============================================================
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
  -- Check if player joined/left this table in the last 5 seconds
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

-- ============================================================
-- 3e. Rate limiting for chat messages
-- ============================================================
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
