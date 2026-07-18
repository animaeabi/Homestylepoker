-- Remove the temporary client-side debug sink used to diagnose the
-- online_hand_not_found issue (root-caused to the missing SECURITY DEFINER,
-- fixed in 20260718030000). No longer needed.
drop function if exists public.client_debug(text, jsonb);
drop table if exists public.client_debug_log;
