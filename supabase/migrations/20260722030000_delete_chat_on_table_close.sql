-- Wipe a table's chat conversation the moment the game ends.
--
-- A table flips to status='closed' when the last player leaves (online_leave_table)
-- or when it's reaped as idle (online_runtime_expire_stale_human_seats). Rather
-- than edit each of those large functions, a single trigger on the status
-- transition deletes that table's chat -- catching every close path in one place.
--
-- Live growth is already bounded elsewhere (last-20-per-table cap + 24h TTL swept
-- hourly by online_private.prune_online_data); this just makes an ended game's
-- conversation disappear immediately instead of lingering until the next sweep.

create or replace function online_delete_chat_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from online_table_chat_messages where table_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_online_delete_chat_on_close on online_tables;
create trigger trg_online_delete_chat_on_close
after update of status on online_tables
for each row
when (new.status = 'closed' and old.status is distinct from 'closed')
execute function online_delete_chat_on_close();
