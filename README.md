# Home Game Buy-in Tracker

Real-time, multi-device poker buy-in tracking with Supabase. Host creates a game, players join by link or QR, and buy-ins update instantly.

## 1) Create the Supabase project

- Create a new project in Supabase.
- Open the SQL editor and run this schema:

```sql
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
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
  name text not null,
  cashout numeric default 0,
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
create index if not exists idx_buyins_game_id on buyins(game_id);
```

- In Supabase, enable Realtime for `games`, `players`, and `buyins`.
- Leave Row Level Security (RLS) **off** for the basic setup.
- If you created the tables earlier, run:

```sql
alter table games add column if not exists ended_at timestamptz;
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
