alter table online_hand_players
  add column if not exists manually_shown boolean not null default false;

drop function if exists online_set_hand_cards_visibility(uuid, uuid, text, boolean);
create or replace function online_set_hand_cards_visibility(
  p_hand_id uuid,
  p_actor_group_player_id uuid,
  p_seat_token text,
  p_show boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_hand online_hands%rowtype;
  v_hand_player online_hand_players%rowtype;
  v_show boolean := coalesce(p_show, true);
begin
  if coalesce(nullif(trim(p_seat_token), ''), '') = '' then
    raise exception 'seat_token_required';
  end if;

  select * into v_hand
  from online_hands
  where id = p_hand_id
  for update;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  if v_hand.state <> 'settled' then
    raise exception 'hand_not_settled';
  end if;

  perform 1
  from online_table_seats s
  where s.table_id = v_hand.table_id
    and s.group_player_id = p_actor_group_player_id
    and s.left_at is null
    and s.seat_token = p_seat_token
    and not coalesce(s.is_bot, false)
  limit 1;

  if not found then
    raise exception 'active_seat_not_found';
  end if;

  select * into v_hand_player
  from online_hand_players hp
  where hp.hand_id = p_hand_id
    and hp.group_player_id = p_actor_group_player_id
  limit 1;

  if not found then
    raise exception 'player_not_in_hand';
  end if;

  if jsonb_array_length(coalesce(v_hand_player.hole_cards, '[]'::jsonb)) < 2 then
    raise exception 'hole_cards_not_available';
  end if;

  if v_hand_player.manually_shown is distinct from v_show then
    update online_hand_players
    set manually_shown = v_show
    where id = v_hand_player.id
    returning * into v_hand_player;

    perform online_append_hand_event(
      p_hand_id,
      v_hand.table_id,
      'cards_visibility_changed',
      p_actor_group_player_id,
      jsonb_build_object(
        'seat_no', v_hand_player.seat_no,
        'shown', v_show
      )
    );

    perform online_write_hand_snapshot(p_hand_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'seat_no', v_hand_player.seat_no,
    'shown', coalesce(v_hand_player.manually_shown, v_show)
  );
end;
$$;
