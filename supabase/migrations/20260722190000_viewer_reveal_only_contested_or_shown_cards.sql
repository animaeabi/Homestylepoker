-- Folded-card privacy: the hand-state viewer revealed EVERY player's hole cards
-- at showdown/settled -- including folded players and uncontested-pot winners who
-- never showed. The UI already hides those, but the cards were still shipped in
-- the JSON payload (readable on the wire). Reveal a player's hole cards only when:
--   * it's the viewer's own seat, OR
--   * they voluntarily showed (manually_shown), OR
--   * a CONTESTED showdown was reached (2+ players still live) and they didn't fold.
-- Uncontested winners now muck by default (own cards still visible to yourself);
-- folded players stay hidden unless they chose to show. Matches real poker and the
-- existing client gating, and closes the wire leak.
create or replace function online_get_hand_state_viewer(
  p_hand_id uuid,
  p_viewer_group_player_id uuid default null,
  p_viewer_seat_token text default null,
  p_since_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hand_row online_hands%rowtype;
  v_hand jsonb;
  v_snapshot jsonb;
  v_players jsonb;
  v_events jsonb;
  v_viewer_seat_no int;
  v_settled boolean := false;
  v_contested boolean := false;
begin
  select * into v_hand_row
  from online_hands h
  where h.id = p_hand_id;

  if not found then
    raise exception 'online_hand_not_found';
  end if;

  v_hand := to_jsonb(v_hand_row) - 'deck_cards' - 'deck_cards_encrypted';
  v_settled := v_hand_row.state in ('showdown', 'settled');

  -- A showdown is "contested" only if two or more players are still live: those
  -- contenders must expose their cards to resolve the pot. An uncontested pot
  -- (everyone else folded) has a single live player who is not required to show.
  if v_settled then
    select count(*) filter (where not folded) >= 2
    into v_contested
    from online_hand_players
    where hand_id = p_hand_id;
  end if;

  if p_viewer_group_player_id is not null
     and coalesce(nullif(trim(p_viewer_seat_token), ''), '') <> ''
  then
    select s.seat_no
    into v_viewer_seat_no
    from online_table_seats s
    where s.table_id = v_hand_row.table_id
      and s.group_player_id = p_viewer_group_player_id
      and s.left_at is null
      and s.seat_token = p_viewer_seat_token
    limit 1;
  end if;

  select state into v_snapshot
  from online_hand_snapshots
  where hand_id = p_hand_id
  order by seq desc
  limit 1;

  select coalesce(
    jsonb_agg(
      case
        when (v_viewer_seat_no is not null and hp.seat_no = v_viewer_seat_no)
             or coalesce(hp.manually_shown, false)
             or (v_settled and v_contested and not coalesce(hp.folded, false))
          then to_jsonb(hp)
        else (to_jsonb(hp) - 'hole_cards') || jsonb_build_object('hole_cards', '[]'::jsonb)
      end
      order by hp.seat_no
    ),
    '[]'::jsonb
  )
  into v_players
  from online_hand_players hp
  where hp.hand_id = p_hand_id;

  select coalesce(jsonb_agg(to_jsonb(ev) order by ev.seq), '[]'::jsonb)
  into v_events
  from online_hand_events ev
  where ev.hand_id = p_hand_id
    and (p_since_seq is null or ev.seq > p_since_seq);

  return jsonb_build_object(
    'hand', v_hand,
    'snapshot', coalesce(v_snapshot, '{}'::jsonb),
    'players', v_players,
    'events', v_events
  );
end;
$$;
