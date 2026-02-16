# Home Game Buy-in Tracker

Real-time, multi-device poker buy-in tracking with Supabase. Host creates a game, players join by link or QR, buy-ins update instantly, and the host can settle the game with final chip counts.

## 1) Create the Supabase project

- Create a new project in Supabase.
- Open the SQL editor and run this schema:

```sql
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lock_phrase_hash text,
  created_at timestamptz default now()
);

create table if not exists group_players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  archived_at timestamptz,
  created_at timestamptz default now(),
  unique (group_id, normalized_name)
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete set null,
  code text unique not null,
  name text not null,
  currency text default '$',
  default_buyin numeric default 20,
  settle_open boolean default false,
  ended_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  group_player_id uuid references group_players(id) on delete set null,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists buyins (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  buyin_event_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_players_game_id on players(game_id);
create index if not exists idx_players_group_player_id on players(group_player_id);
create index if not exists idx_buyins_game_id on buyins(game_id);
create index if not exists idx_games_group_id on games(group_id);
create index if not exists idx_group_players_group_id on group_players(group_id);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now()
);

create table if not exists settlement_adjustments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now()
);

create table if not exists player_exits (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  left_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  group_player_id uuid references group_players(id) on delete cascade,
  player_name text not null,
  status text not null default 'pending',
  requested_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references players(id) on delete set null
);

create index if not exists idx_settlements_game_id on settlements(game_id);
create index if not exists idx_settlement_adjustments_game_id on settlement_adjustments(game_id);
create index if not exists idx_player_exits_game_id on player_exits(game_id);
create index if not exists idx_player_exits_player_id on player_exits(player_id);
create index if not exists idx_join_requests_game_id on join_requests(game_id);
create index if not exists idx_join_requests_group_player_id on join_requests(group_player_id);
```

- In Supabase, enable Realtime for `games`, `players`, `buyins`, `settlements`, `settlement_adjustments`, `player_exits`, and `join_requests`.
- For quick local testing, you can leave Row Level Security (RLS) **off**.
- If you created the tables earlier, run:

```sql
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lock_phrase_hash text,
  created_at timestamptz default now()
);

create table if not exists group_players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  archived_at timestamptz,
  created_at timestamptz default now(),
  unique (group_id, normalized_name)
);

alter table games add column if not exists group_id uuid references groups(id) on delete set null;
alter table games add column if not exists host_player_id uuid references players(id) on delete set null;
alter table groups add column if not exists lock_phrase_hash text;
alter table group_players add column if not exists archived_at timestamptz;
alter table games add column if not exists settle_open boolean default false;
alter table games add column if not exists ended_at timestamptz;
alter table players add column if not exists group_player_id uuid references group_players(id) on delete set null;
alter table buyins add column if not exists buyin_event_at timestamptz default now();
update buyins set buyin_event_at = created_at where buyin_event_at is null;
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now()
);
create table if not exists settlement_adjustments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now()
);
create table if not exists player_exits (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  left_at timestamptz default now(),
  created_at timestamptz default now()
);
create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  group_player_id uuid references group_players(id) on delete cascade,
  player_name text not null,
  status text not null default 'pending',
  requested_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references players(id) on delete set null
);
create index if not exists idx_settlements_game_id on settlements(game_id);
create index if not exists idx_settlement_adjustments_game_id on settlement_adjustments(game_id);
create index if not exists idx_player_exits_game_id on player_exits(game_id);
create index if not exists idx_player_exits_player_id on player_exits(player_id);
create index if not exists idx_join_requests_game_id on join_requests(game_id);
create index if not exists idx_join_requests_group_player_id on join_requests(group_player_id);
create index if not exists idx_players_group_player_id on players(group_player_id);
create index if not exists idx_games_group_id on games(group_id);
create index if not exists idx_group_players_group_id on group_players(group_id);
```

## 2) Add your keys

Open `config.js` and paste your project values:

```js
export const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
```

## 3) Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## 3.1) Optional: Online Poker Foundation (MVP backend)

If you want to start building online Hold'em tables (additive; does not modify existing tracker flows):

1. Open Supabase SQL Editor.
2. Run `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`.
3. Use `/Users/abishek/Documents/poker-buyins/online/client.js` as the thin RPC wrapper from app/server code.
4. Refer to `/Users/abishek/Documents/poker-buyins/docs/ONLINE_POKER_MVP.md` for the scope and milestones.
5. For showdown payout resolution, use:
   - `/Users/abishek/Documents/poker-buyins/online/showdown.js`
   - `/Users/abishek/Documents/poker-buyins/online/settle_showdown.js`
6. For backend runtime automation (auto-advance all-in streets + auto-settle showdown), run:
   - `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node /Users/abishek/Documents/poker-buyins/online/runtime_worker.js`

### 3.2) Optional: Online backend smoke checks

Run local checks before frontend integration:

```bash
node --check /Users/abishek/Documents/poker-buyins/online/client.js
node --check /Users/abishek/Documents/poker-buyins/online/showdown.js
node --check /Users/abishek/Documents/poker-buyins/online/settle_showdown.js
node --check /Users/abishek/Documents/poker-buyins/online/runtime_worker.js
node /Users/abishek/Documents/poker-buyins/online/showdown.test.js
node /Users/abishek/Documents/poker-buyins/online/runtime_worker.test.js
```

## 4) Security hardening (production)

Use this only when you are ready to require signed-in users.

1. Enable Supabase Auth.
2. Add ownership columns:

```sql
alter table groups add column if not exists owner_user_id uuid;
alter table games add column if not exists owner_user_id uuid;

create index if not exists idx_groups_owner_user_id on groups(owner_user_id);
create index if not exists idx_games_owner_user_id on games(owner_user_id);
```

3. Enable RLS and add owner policies:

```sql
alter table groups enable row level security;
alter table group_players enable row level security;
alter table games enable row level security;
alter table players enable row level security;
alter table buyins enable row level security;
alter table settlements enable row level security;
alter table settlement_adjustments enable row level security;
alter table join_requests enable row level security;

create policy groups_owner_all on groups
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy games_owner_all on games
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy group_players_via_group_owner on group_players
for all to authenticated
using (exists (select 1 from groups g where g.id = group_players.group_id and g.owner_user_id = auth.uid()))
with check (exists (select 1 from groups g where g.id = group_players.group_id and g.owner_user_id = auth.uid()));

create policy players_via_game_owner on players
for all to authenticated
using (exists (select 1 from games g where g.id = players.game_id and g.owner_user_id = auth.uid()))
with check (exists (select 1 from games g where g.id = players.game_id and g.owner_user_id = auth.uid()));

create policy buyins_via_game_owner on buyins
for all to authenticated
using (exists (select 1 from games g where g.id = buyins.game_id and g.owner_user_id = auth.uid()))
with check (exists (select 1 from games g where g.id = buyins.game_id and g.owner_user_id = auth.uid()));

create policy settlements_via_game_owner on settlements
for all to authenticated
using (exists (select 1 from games g where g.id = settlements.game_id and g.owner_user_id = auth.uid()))
with check (exists (select 1 from games g where g.id = settlements.game_id and g.owner_user_id = auth.uid()));

create policy adjustments_via_game_owner on settlement_adjustments
for all to authenticated
using (exists (select 1 from games g where g.id = settlement_adjustments.game_id and g.owner_user_id = auth.uid()))
with check (exists (select 1 from games g where g.id = settlement_adjustments.game_id and g.owner_user_id = auth.uid()));

create policy join_requests_via_game_owner on join_requests
for all to authenticated
using (exists (select 1 from games g where g.id = join_requests.game_id and g.owner_user_id = auth.uid()))
with check (exists (select 1 from games g where g.id = join_requests.game_id and g.owner_user_id = auth.uid()));
```

## Notes

- Without Auth + RLS, anyone with the join link can write data.
- For public use, apply section 4 and use authenticated users.
- Cash-outs are handled via the settlement flow (final chip totals).
- If you already created a `cashout` column, you can leave it; the app ignores it.
