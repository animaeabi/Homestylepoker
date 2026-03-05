# Poker Buy-ins / Poker Nights — Agent Handoff Context

## 1) Project Intent
- This repo has a **working in-person poker tracker** (buy-ins, settle, groups, history, stats).
- A **real online poker experience** is now integrated — standalone, no group requirement, full Texas Hold'em gameplay.
- Visual style: dark theme with gold accents (PokerStars/GGPoker-inspired for online), mobile-first.

## 2) Critical Product Constraint
- **Do not break existing in-person flow.**
  - `Deal` / `Join Table` / group history / settlement / my performance must continue to work.
- Online mode is a clean separate mode accessible from the landing page.

## 3) Current Online Architecture
- Entry from landing button:
  - `app.js` (`#openOnlineTable`) → navigates to `online-table.html`
- Single-page online app:
  - `online-table.html` — lobby screen + table view (modern dark theme)
  - `online/table_app.js` — all online logic (lobby, table rendering, actions, realtime)
  - `online/client.js` — Supabase RPC wrapper
  - `online/showdown.js` — Texas Hold'em hand evaluator + payout resolver
- Online backend (Supabase SQL/RPC):
  - `supabase/online_poker_schema.sql`
- Runtime tick (Edge Function):
  - `supabase/functions/online-runtime-tick/index.ts`

## 4) Identity System
- Online play is **standalone** — no group selection required from the user.
- `online_ensure_lobby_player(name)` auto-creates a hidden `__online_lobby__` group and `group_player` by name.
- All existing RPCs work unchanged since the player gets a valid `group_player_id`.
- Seat tokens lock device-to-seat identity.

## 5) Online Game Flow
1. Player opens `online-table.html` → sees lobby.
2. **Create Table**: enter name, configure blinds/stack/seats/chip mode → creates table + auto-sits.
3. **Join Table** (via shared `?table=UUID` link): enter name → joins and sits.
4. Host clicks "Deal Hand" to start each hand.
5. Full turn-by-turn play: fold/check/call/bet/raise/all-in with slider and presets.
6. Showdown evaluated server-side via Edge Function (`online-runtime-tick`).
7. Turn timeout: 25 seconds, auto-fold via Edge Function.
8. Rebuy available when stack reaches 0 between hands.

## 6) Authority Model
- **Host**: `created_by_group_player_id` on table. Can start hands, force-advance.
- **Seat token**: Required for all mutations. Validated server-side. Stripped from client reads.
- **Turn enforcement**: `action_seat` must match player's `seat_no` in `online_submit_action`.

## 7) Key Database Objects (Online)
- Tables: `online_tables`, `online_table_seats`, `online_hands`, `online_hand_players`, `online_hand_events`, `online_hand_snapshots`, `online_actions`
- New columns: `online_tables.starting_stack`, `online_tables.chip_mode`
- Key RPCs: `online_ensure_lobby_player`, `online_create_table`, `online_join_table`, `online_leave_table`, `online_start_hand`, `online_submit_action`, `online_advance_hand`, `online_settle_showdown`, `online_rebuy_chips`

## 8) Manual Verification Checklist
- Device A opens lobby, creates table, sits.
- Device A copies link, Device B opens it.
- Device B enters name, joins table, sits.
- Both seats visible to each other in real time.
- Host starts hand, cards dealt, blinds posted.
- Turn passes correctly with timer.
- Wrong device cannot act for other seat.
- Host-only controls are blocked for non-host.
- Refresh/reopen does not lose seat ownership.
- Pot/board/events stay synchronized.
- Showdown evaluates correctly, pot awarded.
- Rebuy works when stack is 0.

## 9) Security Note
- A Supabase service-role key was exposed in chat history.
- Rotate compromised key immediately in Supabase and update any local env usage.
- No RLS is currently enabled; security relies on RPC-level checks.

## 10) Working Style for Next Agent
- Keep changes minimal and deterministic.
- Prioritize functional correctness over visual polish.
- No schema-breaking edits to existing in-person tables.
- If changing online SQL functions, make migration-safe (`drop function if exists ...` + recreate).
- Validate with `node --check` on modified JS files before handoff.
