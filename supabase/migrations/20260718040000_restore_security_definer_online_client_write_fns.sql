-- Same class of regression as online_submit_action (20260718030000): several
-- anon-callable online functions that mutate RLS-protected online tables are
-- SECURITY INVOKER. Run as anon, their UPDATE/INSERT is silently filtered to
-- zero rows by RLS and the call "succeeds" without doing anything.
--
-- Visible symptom: online_rebuy_chips returned success ("Chips added!") but the
-- seat's chip_stack stayed 0, so the player could never get chips to play.
-- The same latent bug affected show-cards, host transfer, player preferences,
-- table settings, and the voice-floor functions.
--
-- Restore SECURITY DEFINER on the client-facing mutation functions so they can
-- write on the caller's behalf. Verified as the anon role: online_rebuy_chips
-- now takes chip_stack from 0 -> 200.
alter function public.online_rebuy_chips(uuid, uuid, text, numeric) security definer;
alter function public.online_set_hand_cards_visibility(uuid, uuid, text, boolean) security definer;
alter function public.online_transfer_table_host(uuid, uuid, text, uuid) security definer;
alter function public.online_update_player_preferences(uuid, uuid, text, boolean) security definer;
alter function public.online_update_table_settings(uuid, uuid, text, numeric, numeric, boolean, integer, integer) security definer;
alter function public.online_claim_voice_floor(uuid, uuid, text, integer) security definer;
alter function public.online_end_voice_call(uuid, uuid, text) security definer;
alter function public.online_refresh_voice_floor(uuid, uuid, text, integer) security definer;
alter function public.online_release_voice_floor(uuid, uuid, text) security definer;
alter function public.online_start_voice_call(uuid, uuid, text) security definer;
