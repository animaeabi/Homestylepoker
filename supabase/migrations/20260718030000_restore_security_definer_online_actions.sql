-- Restore SECURITY DEFINER on the online gameplay write functions.
--
-- The online security gate (20260326120200) marked these functions
-- SECURITY DEFINER so they can read/write the RLS-protected online tables
-- (online_hands has RLS with no anon SELECT policy). A later `create or
-- replace function` (the IO hot-path refactor, 20260414101500, and related)
-- re-created several of them WITHOUT the `security definer` clause, which
-- silently reverted them to SECURITY INVOKER.
--
-- Consequence: when the anon client called online_submit_action, the function
-- ran as `anon` and its `select ... from online_hands where id = p_hand_id`
-- was blocked by RLS (zero rows) -> raised `online_hand_not_found` on EVERY
-- human action. Bots were unaffected because the runtime edge function acts as
-- `service_role` (bypasses RLS). Net effect: humans could never act and were
-- auto-folded every hand.
--
-- Restoring SECURITY DEFINER lets these functions run as their owner and
-- bypass RLS, exactly as the security gate intended. Verified end-to-end by
-- calling online_submit_action as the `anon` role: a Call now returns
-- status='accepted' instead of online_hand_not_found.
alter function public.online_submit_action(uuid, uuid, text, numeric, text, text) security definer;
alter function public.online_continue_hand(uuid, uuid, text) security definer;
alter function public.online_append_hand_event(uuid, uuid, text, uuid, jsonb) security definer;
alter function public.online_write_hand_snapshot(uuid) security definer;
alter function public.online_check_action_rate_limit(uuid, uuid) security definer;
alter function public.online_post_table_chat_message(uuid, uuid, text, text) security definer;
alter function public.online_request_turn_grace(uuid, uuid, text, integer) security definer;
alter function public.online_start_hand(uuid, uuid) security definer;
