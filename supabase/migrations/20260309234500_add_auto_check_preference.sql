alter table online_table_seats
  add column if not exists auto_check_when_available boolean not null default false;

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
