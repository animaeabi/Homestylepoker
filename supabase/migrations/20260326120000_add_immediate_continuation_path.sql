-- Phase 1: Immediate continuation path
-- Adds online_post_action_continuation() and online_continue_hand() for
-- sub-300ms action latency, and updates online_runtime_processable_hands()
-- to skip recently-acted hands (3s grace) so the cron doesn't race with
-- the continuation path.

-- 1a. Read-only status: what follow-up does this hand need?
drop function if exists online_post_action_continuation(uuid);
create or replace function online_post_action_continuation(
  p_hand_id uuid
)
returns jsonb
language sql
stable
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

-- 1b. Client-callable continuation RPC
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
  v_recent_count int;
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

  -- Rate limit: max 2 calls per table per second
  select count(*) into v_recent_count
  from online_hand_events
  where table_id = v_table_id
    and event_type = 'continuation_attempted'
    and created_at > now() - interval '1 second';

  if v_recent_count >= 2 then
    return jsonb_build_object(
      'continued', false,
      'triggered_runtime', false,
      'final_state', v_hand.state,
      'reason', 'rate_limited'
    );
  end if;

  -- Record continuation attempt for rate limiting
  perform online_append_hand_event(
    p_hand_id,
    v_table_id,
    'continuation_attempted',
    p_actor_group_player_id,
    '{}'::jsonb
  );

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

-- 1d. Update processable hands to skip recently-continued hands
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
