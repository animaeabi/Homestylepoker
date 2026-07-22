-- Hotfix: the bot_character migration's drop listed the prior online_join_table
-- signature as (..., uuid, uuid) but the real 9-param version ends
-- (..., p_actor_group_player_id uuid, p_actor_seat_token text). The stale
-- overload survived alongside the new 10-param version, so PostgREST returned
-- PGRST203 ("could not choose the best candidate") on every join -- which also
-- broke table creation, since Create & Play joins immediately after creating.
-- Drop the stale overload; the 10-param version (with p_bot_character) remains.
drop function if exists public.online_join_table(uuid, uuid, integer, numeric, text, boolean, text, uuid, text);
