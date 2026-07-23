-- Conversation intensity modes: how alive the table talk is. Three narrative
-- registers, selectable per table in Settings:
--   quiet  - Quiet Professional: long silences, sparse dry observations,
--            private thoughts carry more of the characterization.
--   social - Social Home Game (default): today's balance of chatter, jokes
--            and needling.
--   drama  - High Drama: stronger rivalries, more callbacks and pressure,
--            bigger post-hand reactions. Still preserves silence during
--            critical decisions (the hush rules stay on).
-- The runtime reads this when scaling every talk-probability knob.
alter table online_tables
  add column if not exists chat_intensity text not null default 'social';
alter table online_tables
  drop constraint if exists online_tables_chat_intensity_check;
alter table online_tables
  add constraint online_tables_chat_intensity_check
  check (chat_intensity in ('quiet', 'social', 'drama'));

-- Seat-token-authed setter (any seated human may switch the table's register;
-- the client only surfaces the control to the host).
create or replace function online_set_chat_intensity(
  p_table_id uuid,
  p_actor_group_player_id uuid,
  p_actor_seat_token text,
  p_intensity text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat online_table_seats%rowtype;
begin
  if p_intensity is null or p_intensity not in ('quiet', 'social', 'drama') then
    raise exception 'invalid_chat_intensity';
  end if;

  select * into v_seat
  from online_table_seats
  where table_id = p_table_id
    and group_player_id = p_actor_group_player_id
    and seat_token = p_actor_seat_token
    and left_at is null
    and is_bot = false;
  if not found then
    raise exception 'active_seat_not_found';
  end if;

  update online_tables
  set chat_intensity = p_intensity
  where id = p_table_id;
end;
$$;

grant execute on function online_set_chat_intensity(uuid, uuid, text, text) to anon, authenticated, service_role;
