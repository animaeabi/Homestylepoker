# Poker Buy-ins / Poker Nights — Agent Handoff Context

## 1) Project Intent
- This repo has a **working in-person poker tracker** (buy-ins, settle, groups, history, stats).
- A **real online poker experience** is integrated — standalone, no group requirement, full Texas Hold'em with AI bots.
- Visual style: dark theme with gold accents, mobile-first with landscape support.

## 2) Critical Product Constraint
- **Do not break existing in-person flow.**
  - `Deal` / `Join Table` / group history / settlement / my performance must continue to work.
- Online mode is a clean separate mode accessible from the Game Lobby on the landing page.
- The `__online_lobby__` group is a hidden system group — it must be filtered out of all in-person UI (Groups, Sessions, selects). Filtering is in `refreshGroups()` in `app.js`.

## 3) Landing Page Structure
- **Game Lobby** card contains two side-by-side accordion buttons: **Home Game** and **Online**.
- **Home Game** accordion: expands to show game name, buy-in, host name, group selector, "Host game" button. This is the in-person tracker flow — do not touch.
- **Online** accordion: expands to show name, table name, blinds (supports cents), starting stack, max seats, "Create & Play" button. Calls `online_ensure_lobby_player` + `online_create_table` + `online_join_table` RPCs directly from `app.js`, then navigates to `online-table.html?table=UUID`.
- **Sessions** sidebar: Casual, Group, and **Online Games** buttons. Online Games shows past tables with settlement stats and a settings gear for "Delete all online games".

## 4) Online Architecture
- Entry: `online-table.html?table=UUID` (from landing page or shared link)
- Frontend files:
  - `online-table.html` — table view with lobby fallback for join links
  - `online/table_app.js` — all online logic (rendering, actions, realtime, bots, auto-deal)
  - `online/client.js` — Supabase RPC wrapper
  - `online/showdown.js` — hand evaluator (bitmask-optimized) + payout resolver
  - `online/bot_engine.js` — AI bot decision engine with opponent modeling
- Backend (Supabase SQL/RPC):
  - `supabase/online_poker_schema.sql`
- Runtime tick (Edge Function):
  - `supabase/functions/online-runtime-tick/index.ts`

## 5) Identity System
- `online_ensure_lobby_player(name)` auto-creates a hidden `__online_lobby__` group and `group_player` by name.
- All existing RPCs work unchanged since the player gets a valid `group_player_id`.
- Seat tokens lock device-to-seat identity, stored in localStorage as `online_seat_token:{tableId}:{playerId}`.

## 6) Online Game Flow
1. Player creates table from landing page Online accordion → navigates to table view already seated.
2. Or player opens a shared `?table=UUID` link → lobby shows name input + "Join Table".
3. **Auto-dealer**: after each hand settles, 5-second pause shows winners, then next hand is auto-dealt. Manual "Deal Hand" button available as fallback for first hand.
4. **AI bots**: host clicks empty seat → popover with "Sit" / "Add Bot". Bots act automatically with 1-3s think delay. 4 personality types (TAG, LAG, Rock, Station). Bots auto-rebuy up to 5 times, then leave.
5. Full turn-by-turn play: fold/check/call/bet/raise/all-in with slider and pot-fraction presets.
6. Turn timeout: 25 seconds, auto-fold via Edge Function.
7. Showdown evaluated server-side via Edge Function.
8. Leave → redirects to landing page. Host transfer to next seated player on host leave. Table closes when all leave.

## 7) AI Bot System
- Bots run **client-side in the host's browser**. Server sees normal player actions.
- `online/bot_engine.js` exports: `decide()`, `OpponentTracker`, `randomPersonality()`, `randomBotName()`, `personalityLabel()`, `thinkTimeMs()`.
- **Personalities**: TAG (tight-aggressive), LAG (loose-aggressive), Rock (tight-passive), Station (calling station). Each has tuned thresholds for fold/raise/bluff/c-bet/check-raise.
- **Opponent modeling**: `OpponentTracker` class tracks VPIP, PFR, aggression, fold-to-bet per human player. Bot decisions adapt: bluff more vs tight/foldy, value-bet more vs loose/calling.
- **Position awareness**: bots play looser on button (+15%), tighter in early position (-12%).
- **Advanced play**: continuation betting (45-75%), check-raise trapping (2-10%), pot odds comparison before calling.
- Bot seats stored in `state.botSeats` Map and persisted to localStorage per table. Includes `rebuyCount` (max 5).

## 8) Poker Algorithm
- **Shuffle**: Fisher-Yates in PL/pgSQL (`online_shuffled_deck()`), seeded by PostgreSQL's `random()`.
- **Hand evaluation**: Bitmask-based straight detection, fixed-array rank/suit counting, single-pass categorization. Correct for all hand types including wheel straights and split pots.
- **Equity calculation**: Monte Carlo simulation (600 samples preflop, exact enumeration for 1-2 unknown cards) for all-in scenarios.

## 9) Key Database Objects (Online)
- Tables: `online_tables`, `online_table_seats`, `online_hands`, `online_hand_players`, `online_hand_events`, `online_hand_snapshots`, `online_actions`
- Columns: `online_tables.starting_stack`, `online_tables.chip_mode`
- Key RPCs: `online_ensure_lobby_player`, `online_create_table`, `online_join_table`, `online_leave_table`, `online_start_hand`, `online_submit_action`, `online_advance_hand`, `online_settle_showdown`, `online_rebuy_chips`
- `online_leave_table` handles: host transfer, pot award to last player, table close when empty, hand cancellation.

## 10) Authority Model
- **Host**: `created_by_group_player_id` on table. Auto-transfers to next seated player when host leaves.
- **Seat token**: Required for all mutations. Validated server-side. Stripped from client reads.
- **Turn enforcement**: `action_seat` must match player's `seat_no` in `online_submit_action`.

## 11) Mobile / Responsive
- Portrait mode: full-height table, larger own cards (`.card-mine`), iOS safe area insets.
- Landscape mode (`@media orientation:landscape, max-height:500px`): wide oval table, compact seats, action bar docked bottom-right on wider phones.
- `font-size: 16px` on inputs to prevent iOS zoom. Min 44px touch targets.

## 12) Manual Verification Checklist
- Landing page: Home Game and Online accordions work independently, mutually exclusive.
- Create table from Online accordion → lands on table view seated.
- Copy link → second device joins via name input.
- Both seats visible in real time. Turn passes correctly with timer.
- Bots: add via empty seat popover, act automatically, auto-rebuy up to 5x, leave after.
- Host leaves → host transfers. All leave → table closes.
- Online Games in Sessions → shows past tables with Open/stats. Delete all online games works (only online data).
- `__online_lobby__` group does NOT appear in Group Sessions.
- In-person Deal/Join/Groups/Casual all work unchanged.

## 13) Security Note
- A Supabase service-role key was exposed in chat history.
- Rotate compromised key immediately in Supabase and update any local env usage.
- No RLS is currently enabled; security relies on RPC-level checks.

## 14) Working Style for Next Agent
- Keep changes minimal and deterministic.
- Prioritize functional correctness over visual polish.
- No schema-breaking edits to existing in-person tables.
- If changing online SQL functions, make migration-safe (`drop function if exists ...` + recreate).
- Validate with `node --check` on modified JS files before handoff.
- The `__online_lobby__` group must remain hidden from all in-person UI.
