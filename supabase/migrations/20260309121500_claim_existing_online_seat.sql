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
