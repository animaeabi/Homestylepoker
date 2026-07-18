-- Enable RLS on the two bot/player read-profile tables.
--
-- These tables are never accessed directly by client code (verified: no
-- reference in app.js or online/table_app.js). They are read/written only by:
--   * SECURITY DEFINER runtime functions (online_submit_action,
--     online_advance_hand, the online_bot_profile_* helpers they call, and
--     online_get_table_state_viewer) — these run as the table owner and
--     bypass RLS.
--   * The online-runtime-tick edge function via service_role, which also
--     bypasses RLS.
--
-- So enabling RLS with NO policies denies all direct anon/authenticated
-- access (previously fully open) without breaking any code path. This closes
-- the "RLS disabled" advisory for these two tables with zero behaviour change.
alter table public.online_player_read_profiles enable row level security;
alter table public.online_table_player_read_profiles enable row level security;
