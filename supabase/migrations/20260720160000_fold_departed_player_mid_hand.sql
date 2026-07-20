-- CRITICAL (audit): leaving/kick/stale-expiry mid-hand only vacated the seat and
-- never folded the player's live online_hand_players row. Turn order still routed
-- to the ghost seat, which the runtime can't act for (no seat token), so the hand
-- froze forever; and if everyone folded to the ghost, the fold-win seat-sync
-- matched nothing and the pot was destroyed. online_kick_table_player and the
-- 300s stale-seat reaper both call online_leave_table, so fixing it covers all
-- three departure paths.
--
-- Add a resolver that folds the departed seat and progresses the hand (settle a
-- fold-win, run out an all-in board, or move action to the next live player), and
-- call it from online_leave_table whenever 2+ seats remain.

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
      -- allin_progress bypasses advance_hand's round-complete guard and its
      -- host checks; it deals the next street (or reaches showdown on river,
      -- which the runtime then settles).
      perform online_advance_hand(p_hand_id, v_actor, 'allin_progress');
      exit when (select state from online_hands where id = p_hand_id) not in ('flop', 'turn', 'river');
    else
      -- Someone can still act. Only reassign if action is stuck on the departed
      -- seat or a seat that can no longer act.
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
end;
$function$;

create or replace function public.online_leave_table(p_table_id uuid, p_group_player_id uuid, p_seat_token text)
 returns online_table_seats
 language plpgsql
 security definer
as $function$
declare
  v_left online_table_seats%rowtype;
  v_active_count int;
  v_is_host boolean := false;
  v_new_host uuid;
  v_mid_hand_id uuid;
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
  else
    -- 2+ players remain: fold the departing player's live hand and progress it,
    -- so the table doesn't freeze on their ghost seat or lose the pot.
    select id into v_mid_hand_id
    from online_hands
    where table_id = p_table_id
      and state in ('preflop', 'flop', 'turn', 'river')
    order by hand_no desc
    limit 1;

    if v_mid_hand_id is not null then
      perform online_fold_departed_and_resolve(v_mid_hand_id, v_left.seat_no);
    end if;
  end if;

  return v_left;
end;
$function$;