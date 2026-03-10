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
    and coalesce(stack_end, 0) > 0;

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
