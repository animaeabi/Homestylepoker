-- Enable Supabase Realtime for online_table_voice_state.
--
-- online/table_app.js subscribes to postgres_changes on this table
-- (queueVoiceRefresh), but the table was never added to the
-- supabase_realtime publication, so voice-state changes were never
-- broadcast to clients. The other tables the client subscribes to
-- (online_tables, online_table_seats, online_hand_events) are already
-- in the publication. Add the missing one.
--
-- Guarded so the migration is idempotent and safe to re-run.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'online_table_voice_state'
  ) then
    alter publication supabase_realtime add table public.online_table_voice_state;
  end if;
end $$;
