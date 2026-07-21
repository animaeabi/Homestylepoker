-- Bot audit (runtime tier):
--
-- 1) Departure folds never woke the runtime. When a leave/kick/stale-expiry
--    fold handed the action to a bot (or ran the hand to showdown),
--    online_fold_departed_and_resolve did not nudge online-runtime-tick, so
--    resolution waited for the 10s cron — permanently on the slow path when the
--    last human left. Fire the same targeted nudge online_continue_hand uses.
--
-- 2) Adding bots had no server-side host check: online_join_table honored
--    p_is_bot from ANY group member (the host gate was client-side only), so
--    anyone could flood a table with bots via a direct RPC call. Bot joins now
--    require the table host's identity + active seat token.

create or replace function public.online_fold_departed_and_resolve(p_hand_id uuid, p_seat_no integer)
 returns void
 language plpgsql
 security definer
as $function$
declare
  v_hand online_hands%rowtype;
  v_hp online_hand_players%rowtype;
  v_actor uuid;
  v_live int;
  v_winner_seat int;
  v_guard int := 0;
  v_cont jsonb;
  v_anon_key text;
  v_dispatch_secret text;
  v_request_id bigint;
begin
  select * into v_hand from online_hands where id = p_hand_id for update;
  if not found then return; end if;
  if v_hand.state not in ('preflop', 'flop', 'turn', 'river') then
    return;
  end if;

  select * into v_hp from online_hand_players
  where hand_id = p_hand_id and seat_no = p_seat_no;
  if not found then return; end if;
  v_actor := v_hp.group_player_id;

  if not v_hp.folded then
    update online_hand_players
    set folded = true, has_acted = true
    where hand_id = p_hand_id and seat_no = p_seat_no;
  end if;

  -- Fold-win: only one non-folded player remains -> settle immediately.
  select count(*) into v_live from online_hand_players
  where hand_id = p_hand_id and not folded;

  if v_live <= 1 then
    select seat_no into v_winner_seat from online_hand_players
    where hand_id = p_hand_id and not folded limit 1;

    if v_winner_seat is not null then
      update online_hand_players
      set result_amount = case when seat_no = v_winner_seat
        then online_normalize_money(coalesce(v_hand.pot_total, 0)) else 0 end
      where hand_id = p_hand_id;

      update online_hand_players
      set stack_end = online_normalize_money(coalesce(stack_end, 0) + coalesce(v_hand.pot_total, 0))
      where hand_id = p_hand_id and seat_no = v_winner_seat;

      update online_table_seats s
      set chip_stack = online_normalize_money(hp.stack_end)
      from online_hand_players hp
      where hp.hand_id = p_hand_id
        and s.table_id = v_hand.table_id
        and s.seat_no = hp.seat_no
        and s.group_player_id = hp.group_player_id
        and s.left_at is null;
    end if;

    update online_hands
    set state = 'settled', action_seat = null, ended_at = now(),
        last_action_at = now(), turn_grace_used_secs = 0
    where id = p_hand_id;

    perform online_append_hand_event(p_hand_id, v_hand.table_id, 'pot_awarded', v_actor,
      jsonb_build_object('winner_seat', v_winner_seat, 'amount', online_normalize_money(coalesce(v_hand.pot_total, 0))));
    perform online_append_hand_event(p_hand_id, v_hand.table_id, 'hand_settled', v_actor,
      jsonb_build_object('reason', 'player_left'));
    perform online_bot_profile_record_hand_completion(p_hand_id, false);
    perform online_write_hand_snapshot(p_hand_id);
    return;
  end if;

  -- 2+ players remain. Progress the hand: run out streets while betting is
  -- closed (everyone remaining all-in), or move action off the departed seat.
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 6;
    select * into v_hand from online_hands where id = p_hand_id for update;
    exit when v_hand.state not in ('preflop', 'flop', 'turn', 'river');

    if online_betting_round_complete(p_hand_id) then
      perform online_advance_hand(p_hand_id, v_actor, 'allin_progress');
      exit when (select state from online_hands where id = p_hand_id) not in ('flop', 'turn', 'river');
    else
      if coalesce(v_hand.action_seat, 0) = p_seat_no
         or not exists (
           select 1 from online_hand_players
           where hand_id = p_hand_id and seat_no = v_hand.action_seat
             and not folded and not all_in
             and online_normalize_money(coalesce(stack_end, 0)) > 0
         )
      then
        update online_hands
        set action_seat = online_next_action_seat(p_hand_id, p_seat_no),
            last_action_at = now(), turn_grace_used_secs = 0
        where id = p_hand_id;
      end if;
      exit;
    end if;
  end loop;

  perform online_write_hand_snapshot(p_hand_id);

  -- Wake the runtime when the departure left work only IT can do (a bot to
  -- act, or a showdown to settle). Without this the table sat on the 10s cron.
  begin
    v_cont := online_post_action_continuation(p_hand_id);
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
            'table_id', v_hand.table_id::text,
            'actor_group_player_id', null,
            'settle_note', 'departure_settle'
          )
        )
        into v_request_id;
      end if;
    end if;
  exception when others then
    -- The nudge is best-effort; the cron still covers it.
    null;
  end;
end;
$function$;

-- Host-only bot joins. Non-bot joins keep the exact existing signature/behavior.
create or replace function public.online_assert_bot_join_allowed(p_table_id uuid, p_actor_group_player_id uuid, p_actor_seat_token text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_host uuid;
begin
  select created_by_group_player_id into v_host from online_tables where id = p_table_id;
  if v_host is null or p_actor_group_player_id is null or p_actor_group_player_id <> v_host then
    raise exception 'host_only';
  end if;
  perform 1
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
    and seat_token = p_actor_seat_token;
  if not found then
    raise exception 'host_seat_token_invalid';
  end if;
end;
$function$;

drop function if exists public.online_join_table(uuid, uuid, integer, numeric, text, boolean, text);

create or replace function public.online_join_table(p_table_id uuid, p_group_player_id uuid, p_preferred_seat integer default null::integer, p_chip_stack numeric default null::numeric, p_seat_token text default null::text, p_is_bot boolean default false, p_bot_personality text default null::text, p_actor_group_player_id uuid default null::uuid, p_actor_seat_token text default null::text)
 returns online_table_seats
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_table online_tables%rowtype;
  v_existing online_table_seats%rowtype;
  v_joined online_table_seats%rowtype;
  v_stack numeric;
begin
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

  if coalesce(p_is_bot, false) then
    perform online_assert_bot_join_allowed(p_table_id, p_actor_group_player_id, p_actor_seat_token);
  else
    perform online_assert_not_banned(p_table_id, p_group_player_id);
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
      last_seen_at = now(),
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
      last_seen_at = now(),
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
$function$;