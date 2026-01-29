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

create index if not exists idx_settlements_game_id on settlements(game_id);
```

- In Supabase, enable Realtime for `games`, `players`, `buyins`, and `settlements`.
- Leave Row Level Security (RLS) **off** for the basic setup.
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
  created_at timestamptz default now(),
  unique (group_id, normalized_name)
);

alter table games add column if not exists group_id uuid references groups(id) on delete set null;
alter table groups add column if not exists lock_phrase_hash text;
alter table games add column if not exists ended_at timestamptz;
alter table players add column if not exists group_player_id uuid references group_players(id) on delete set null;
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now()
);
create index if not exists idx_settlements_game_id on settlements(game_id);
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

## Notes

- This basic version is open to anyone with the join link.
- If you plan to host it publicly, add Supabase Auth or a lightweight server to enforce access.
- Cash-outs are handled via the settlement flow (final chip totals).
- If you already created a `cashout` column, you can leave it; the app ignores it.
