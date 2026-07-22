-- Lock down trusted-boundary functions flagged by a static security audit so
-- they are callable ONLY by the service role (the edge runtime), never by anon
-- or authenticated.
--
-- Verified non-breaking: the browser client calls none of these; the production
-- settler is the service-role edge function; and internal SQL callers run inside
-- SECURITY DEFINER functions owned by postgres (which retains EXECUTE as owner
-- regardless of these grants).
--
--  * online_settle_showdown  -- SECURITY DEFINER; trusts caller-supplied payouts
--    (never recomputes the winner), so an anon caller could award itself the pot.
--  * online_claim_table_seat -- SECURITY DEFINER; rotates + returns a seat token
--    from two public UUIDs with no ownership proof (seat hijack).
--  * online_get_hand_state   -- returns the full deck + every hole card. SECURITY
--    INVOKER, so RLS on online_hands / online_hand_players already denies anon;
--    revoked anyway so a future permissive policy can never turn it into a leak.
--    The browser uses online_get_hand_state_viewer (SECURITY DEFINER) instead.
--  * online_private.*        -- deck-crypto + secret helpers; server-only.

revoke all on function online_settle_showdown(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function online_settle_showdown(uuid, jsonb, uuid, text) to service_role;

revoke all on function online_claim_table_seat(uuid, uuid) from public, anon, authenticated;
grant execute on function online_claim_table_seat(uuid, uuid) to service_role;

revoke all on function online_get_hand_state(uuid, bigint) from public, anon, authenticated;
grant execute on function online_get_hand_state(uuid, bigint) to service_role;

revoke all on function online_private.get_deck_crypto_key() from public, anon, authenticated;
grant execute on function online_private.get_deck_crypto_key() to service_role;
revoke all on function online_private.pack_remaining_deck(jsonb) from public, anon, authenticated;
grant execute on function online_private.pack_remaining_deck(jsonb) to service_role;
revoke all on function online_private.unpack_remaining_deck(jsonb, text) from public, anon, authenticated;
grant execute on function online_private.unpack_remaining_deck(jsonb, text) to service_role;
revoke all on function online_private.get_runtime_dispatch_secret() from public, anon, authenticated;
grant execute on function online_private.get_runtime_dispatch_secret() to service_role;
revoke all on function online_private.get_supabase_anon_key() from public, anon, authenticated;
grant execute on function online_private.get_supabase_anon_key() to service_role;
