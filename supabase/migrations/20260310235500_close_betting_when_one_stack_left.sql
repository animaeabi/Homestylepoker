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
    and coalesce(stack_end, 0) > 0;

  if coalesce(array_length(v_actionable_seats, 1), 0) = 0 then
    return null;
  end if;

  -- If only one player still has chips behind, betting is closed.
  -- The runtime should continue dealing streets / showdown without
  -- granting that player another decision they cannot be contested on.
  if coalesce(array_length(v_actionable_seats, 1), 0) = 1 then
    return null;
  end if;

  -- Heads-up postflop: the dealer/button acts first.
  if array_length(v_actionable_seats, 1) = 2
     and p_button_seat is not null
     and p_button_seat = any(v_actionable_seats) then
    return p_button_seat;
  end if;

  return online_next_active_seat(v_actionable_seats, p_button_seat);
end;
$$;
