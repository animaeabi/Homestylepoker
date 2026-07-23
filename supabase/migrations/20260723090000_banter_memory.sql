-- Living table history for the character ensemble: notable hand events
-- (caught bluffs, hero calls, coolers, steals), per-character emotional state
-- that drifts across hands, directional relationships (grudges / respect), and
-- social reads on the human players (fold streaks, tank habits, showdown
-- record). Written only by the runtime at settle time (single writer); read
-- when building every chat / banter / inner-thought prompt so the characters
-- share one continuous session instead of reacting from amnesia.
alter table online_tables
  add column if not exists banter_memory jsonb not null default '{}'::jsonb;
