-- Remove the temporary client debug sink (re-added to diagnose the stuck
-- action buttons; root-caused to a stale state.pendingAction, fixed client-side).
drop function if exists public.client_debug(text, jsonb);
drop table if exists public.client_debug_log;
