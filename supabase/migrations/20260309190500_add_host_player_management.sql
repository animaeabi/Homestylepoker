drop function if exists online_kick_table_player(uuid, uuid, text, uuid);
create or replace function online_kick_table_player(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_target_group_player_id uuid
)
returns online_table_seats
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_target_seat online_table_seats%rowtype;
  v_left online_table_seats%rowtype;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  select * into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
    and seat_token = p_actor_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_only';
  end if;

  if p_target_group_player_id is null then
    raise exception 'target_player_required';
  end if;

  if p_target_group_player_id = p_actor_group_player_id then
    raise exception 'host_cannot_kick_self';
  end if;

  select * into v_target_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_target_group_player_id
    and left_at is null
  limit 1;

  if not found then
    raise exception 'target_player_not_seated';
  end if;

  select * into v_left
  from online_leave_table(
    p_table_id,
    p_target_group_player_id,
    v_target_seat.seat_token
  );

  return v_left;
end;
$$;

drop function if exists online_transfer_table_host(uuid, uuid, text, uuid);
create or replace function online_transfer_table_host(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_target_group_player_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_table online_tables%rowtype;
  v_actor_seat online_table_seats%rowtype;
  v_target_seat online_table_seats%rowtype;
  v_target_name text;
begin
  if coalesce(nullif(trim(p_actor_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_table
  from online_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'online_table_not_found';
  end if;

  select * into v_actor_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and left_at is null
    and seat_token = p_actor_seat_token
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  if v_table.created_by_group_player_id is distinct from p_actor_group_player_id then
    raise exception 'host_only';
  end if;

  if p_target_group_player_id is null then
    raise exception 'target_player_required';
  end if;

  select *
  into v_target_seat
  from online_table_seats s
  where s.table_id = p_table_id
    and s.group_player_id = p_target_group_player_id
    and s.left_at is null
  limit 1;

  if not found then
    raise exception 'target_player_not_seated';
  end if;

  select gp.name
  into v_target_name
  from group_players gp
  where gp.id = p_target_group_player_id;

  if coalesce(v_target_seat.is_bot, false) or coalesce(v_target_name, '') ilike 'Bot %' then
    raise exception 'host_transfer_requires_human_player';
  end if;

  update online_tables
  set created_by_group_player_id = p_target_group_player_id
  where id = p_table_id;

  return jsonb_build_object(
    'table_id', p_table_id,
    'host_group_player_id', p_target_group_player_id,
    'host_name', coalesce(v_target_name, 'Player')
  );
end;
$$;
