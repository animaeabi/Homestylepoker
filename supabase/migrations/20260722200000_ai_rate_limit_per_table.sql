-- Server-side rate limiting for AI/TTS edge calls. The edge only throttles the
-- client today, so a modified client with a valid seat token could hammer Gemini
-- and drain the shared free-tier quota. This enforces a per-table, per-minute cap
-- inside the trusted (service-role) boundary.
--
-- The usage table lives in online_private; the callable function lives in public
-- (the edge reaches RPCs through PostgREST, which only exposes public) and is
-- locked to service_role.

create table if not exists online_private.ai_rate (
  table_id      uuid        not null,
  kind          text        not null,        -- 'tts' | 'chat'
  minute_bucket timestamptz not null,        -- date_trunc('minute', now())
  count         int         not null default 0,
  primary key (table_id, kind, minute_bucket)
);

-- Atomically record one use and report whether we are still within the limit for
-- this table+kind in the current minute. Returns true = allowed, false = over cap.
create or replace function online_ai_rate_hit(
  p_table_id uuid,
  p_kind text,
  p_limit int
)
returns boolean
language plpgsql
security definer
set search_path = public, online_private, pg_temp
as $$
declare
  v_bucket timestamptz := date_trunc('minute', now());
  v_count int;
begin
  if p_table_id is null then
    return true;  -- no table context: don't block
  end if;

  insert into online_private.ai_rate (table_id, kind, minute_bucket, count)
  values (p_table_id, p_kind, v_bucket, 1)
  on conflict (table_id, kind, minute_bucket)
  do update set count = online_private.ai_rate.count + 1
  returning count into v_count;

  -- Opportunistic cleanup so the table stays tiny.
  delete from online_private.ai_rate where minute_bucket < now() - interval '10 minutes';

  return v_count <= greatest(p_limit, 1);
end;
$$;

revoke all on function online_ai_rate_hit(uuid, text, int) from public, anon, authenticated;
grant execute on function online_ai_rate_hit(uuid, text, int) to service_role;
