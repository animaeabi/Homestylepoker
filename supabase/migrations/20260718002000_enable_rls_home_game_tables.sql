-- Enable RLS on the home-game (offline ledger) tables.
--
-- ⚠️ IMPORTANT — these are intentionally PERMISSIVE ("cosmetic") policies.
-- They exist to satisfy the Supabase "RLS disabled" advisor, NOT to provide
-- real access control. The home-game UI (app.js) talks to these tables
-- directly with the PUBLIC anon key and has no Supabase Auth / server-verified
-- identity, so anon must retain full read/write access for the app to work.
-- Anyone with the anon key can still read or modify every row. Real row-level
-- protection would require routing writes through SECURITY DEFINER RPCs gated
-- by a server-verified secret (or adding Supabase Auth) — deliberately out of
-- scope here.
--
-- Each table gets one FOR ALL policy granting anon + authenticated full access.
-- Idempotent: drops any existing same-named policy first so re-runs are safe.

do $$
declare
  t text;
  tables text[] := array[
    'games',
    'players',
    'buyins',
    'settlements',
    'groups',
    'group_players',
    'join_requests',
    'settlement_adjustments',
    'player_exits'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_anon_full_access', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
      t || '_anon_full_access', t
    );
  end loop;
end $$;
