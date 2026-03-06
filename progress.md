Original prompt: ok lets do it

- Added online poker MVP blueprint: /Users/abishek/Documents/poker-buyins/docs/ONLINE_POKER_MVP.md
- Added additive Supabase schema for online mode: /Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql
- Added deterministic authoritative-engine scaffold: /Users/abishek/Documents/poker-buyins/online/holdem_engine.js

Next suggested steps:
1) Decide where authoritative runtime lives (Supabase Edge Function vs dedicated Node service).
2) Implement table create/join/leave API with seat locking.
3) Wire event append + snapshot write path before UI integration.

Update (M2 pass):
- Added SQL RPC set in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` for:
  - table create/join/leave
  - hand start/action/advance
  - snapshot + state retrieval
- Fixed `online_advance_hand` event payload to emit correct `from` state.
- Added JS wrapper client in `/Users/abishek/Documents/poker-buyins/online/client.js`.
- Documented RPC contract in `/Users/abishek/Documents/poker-buyins/docs/ONLINE_POKER_MVP.md`.
- Added README section for optional online backend setup.

Next suggested steps:
1) Build a small server/edge runtime loop to call `online_advance_hand` based on turn timers.
2) Enforce stricter betting validation in SQL (`toCall`, min raise, turn ownership) before UI exposure.
3) Add websocket/table channel fan-out (`snapshot + delta`) for reconnect-safe live play.

Update (backend completion pass):
- Extended online schema with action-state columns:
  - `online_hands`: `deck_cards`, `current_bet`, `min_raise`, `action_seat`, `last_action_at`
  - `online_hand_players`: `street_contribution`, `has_acted`
- Replaced `online_start_hand` with full bootstrap:
  - shuffled deck, hole cards, blinds, initial action seat
- Replaced `online_submit_action` with strict turn-based validation + street transitions.
- Added showdown settlement RPC:
  - `online_settle_showdown(hand_id, payouts, actor, note)`
- Added aggregate table-state RPC:
  - `online_get_table_state(table_id, since_seq)`
- Added JS showdown resolver:
  - `/Users/abishek/Documents/poker-buyins/online/showdown.js`
  - `/Users/abishek/Documents/poker-buyins/online/settle_showdown.js`
- Added quick tests:
  - `/Users/abishek/Documents/poker-buyins/online/showdown.test.js` (passes)

Next suggested steps:
1) Add a small Node/Edge worker loop to auto-resolve showdown and optional turn timeout folds.
2) Add websocket fan-out service (`snapshot + delta`) for multi-device live action.
3) Start frontend integration (group-level Online Lobby + Table screen) against these RPCs.

Update (backend runtime pass):
- Added backend runtime worker:
  - `/Users/abishek/Documents/poker-buyins/online/runtime_worker.js`
  - Polls active hands.
  - Auto-advances all-in boards (`allin_progress`) until actionable state/showdown.
  - Auto-settles showdown using `showdown.js` -> `online_settle_showdown`.
- Added worker tests:
  - `/Users/abishek/Documents/poker-buyins/online/runtime_worker.test.js` (passes)
- Updated docs:
  - `/Users/abishek/Documents/poker-buyins/README.md`
  - `/Users/abishek/Documents/poker-buyins/docs/ONLINE_POKER_MVP.md`

Next suggested steps:
1) Add websocket fan-out service (`snapshot + delta`) for multi-device live action.
2) Add auth/RLS policies for online tables when moving beyond trusted groups.
3) Frontend integration against the online RPC + runtime worker.

Update (frontend test harness pass):
- Added backend-facing online test UI:
  - `/Users/abishek/Documents/poker-buyins/online-lab.html`
  - `/Users/abishek/Documents/poker-buyins/online/lab.js`
- Harness supports:
  - table create/select/refresh
  - seat join/leave
  - hand start
  - action submit (fold/check/call/bet/raise/all_in)
  - force advance
  - live poll of table/hand/seat/event state
- Updated README with online-lab usage instructions.

Update (online table behavior pass):
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` to improve PokerNow-like runtime behavior:
  - Auto-starts a new hand when latest hand is settled/canceled and 2+ seats are occupied (with cooldown guard), so table defaults to live turn-by-turn play instead of sitting on settled snapshot.
  - Added live all-in equity estimation (Monte Carlo/exact depending on unknown board cards) using `resolveShowdownPayouts` from `showdown.js`; seat % now represents live equity in all-in phases, not settled payout share.
  - Added seat occupant fallback from hand player mapping when seat mapping lags, to avoid false `SIT` labels.
  - Added per-turn UX emphasis class toggles so only actor controls are visually emphasized.
- Updated `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - Added IDs/hooks for action emphasis (`#actionGrid`, `#amountField`).
  - Added actor/spectator visual states in CSS.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/showdown.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/showdown.test.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/runtime_worker.test.js` (pass)
- Playwright run blocked because `playwright` package is not installed in this environment (`ERR_MODULE_NOT_FOUND`).

Update (mobile online table polish pass):
- Implemented requested PokerNow-like functionality improvements while keeping current visual style:
  1) Live hand default behavior reinforced:
     - `ensureLiveHandDefault()` now auto-starts next hand with fallback occupied-seat counting from both table seats and latest hand players.
  2) Live all-in equity percentages:
     - Added `calculateLiveAllInEquity()` in `/online/table_app.js` (exact combinations for <=2 unknown board cards, Monte Carlo otherwise).
     - Seat percentages now represent live all-in equity; removed settled payout-based seat % display.
  3) Per-turn UX emphasis:
     - Added actor/spectator emphasis classes for action controls and amount field.
- Mobile layout cleanup in `/online-table.html`:
  - Reduced seat panel/card sizes, hid verbose seat footer/showdown rows on mobile, compacted center chips and board cards.
  - Aims to prevent overlap and keep table readable on portrait screens.

Validation:
- `node --check online/table_app.js` (pass)
- `node --check online/showdown.js` (pass)
- `node online/showdown.test.js` (pass)
- `node online/runtime_worker.test.js` (pass)
- Visual Playwright check unavailable in this environment due browser launch conflict.

Update (mobile hamburger/options controls pass):
- Added functional mobile/tablet options toggle wiring in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - `#optionsToggle` now opens/closes the options panel.
  - Backdrop click + close button close the panel.
  - Escape key closes the panel.

Update (integrated online foundation hardening pass):
- Added viewer-safe RPCs in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`:
  - `online_get_hand_state_viewer(...)`
  - `online_get_table_state_viewer(...)`
  - Client reads now mask other players’ `hole_cards` until showdown/settled (or if seat token + viewer seat match).
- Updated `/Users/abishek/Documents/poker-buyins/online/client.js`:
  - `getTableState()` now prefers `online_get_table_state_viewer` with `viewerGroupPlayerId + viewerSeatToken`.
  - Backward-compatible fallback to `online_get_table_state` if schema not yet applied.
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - Added launch context parsing from URL (`?group=...&player=...&table=...`).
  - Group/player/table preselection now auto-applies from launch context.
  - Table state loads pass viewer context for secure card masking.
- Updated `/Users/abishek/Documents/poker-buyins/app.js`:
  - `Online Table` button now launches with current app context (`group` + current/host `player`), so online mode opens against active group flow rather than blank selectors.
- Updated Edge runtime in `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts`:
  - Added turn-timeout fold enforcement (25s) using authoritative `seat_token`.
  - Runtime now submits forced `fold` when actor times out, then continues normal progression/showdown settlement.

Validation:
- `node --check app.js` (pass)
- `node --check online/client.js` (pass)
- `node --check online/table_app.js` (pass)
- `node --check online/showdown.js` (pass)
- `node online/showdown.test.js` (pass)
- `node online/runtime_worker.test.js` (pass)
- `deno check supabase/functions/online-runtime-tick/index.ts` (blocked: `deno` missing locally)
- Playwright skill client run blocked (missing `playwright` package in local Node environment).

Next suggested steps:
1) Add per-table join links with signed seat-claim flow (no free-form player selector impersonation).
2) Add explicit action timer UI + timeout countdown sync from server `last_action_at`.
3) Add RLS + service-role-only RPC split for online tables before public exposure.
  - Panel auto-closes when viewport exits the mobile/tablet breakpoint.
- Added refs/state helpers for options UI (`optionsPanel`, `optionsToggle`, `optionsBackdrop`, `optionsCloseBtn`) and `body.options-open` control.
- Updated `/Users/abishek/Documents/poker-buyins/online-table.html` styles:
  - Hamburger button now appears up to `980px` width.
  - Added small `OPTIONS` label under the hamburger for discoverability.
  - Mobile drawer changed from full-width to left-anchored floating panel (`max ~460px`) so gameplay remains visible.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/showdown.test.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/runtime_worker.test.js` (pass)

Update (PokerNow-style mobile options menu pass):
- Implemented a two-step mobile options journey for `/online-table.html` and `/online/table_app.js`:
  - Tap hamburger (`☰`) -> opens menu list.
  - Menu options now include:
    - `Game Config`
    - `Groups & Players`
  - Added `Back` flow inside options to return to menu list.
- Added mobile options UI state management in JS (`setMobileOptionsSection`) and section visibility control:
  - Home list (menu)
  - Game config section
  - Groups/players section
- Refactored topbar controls into two blocks:
  - `#groupPlayersSection` (group/player/table + refresh/sit/leave)
  - `#gameConfigSection` (table name, SB/BB, new table)
- Kept desktop behavior intact: all control sections visible in topbar.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/showdown.test.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/runtime_worker.test.js` (pass)
- Playwright skill run attempted but blocked by missing local `playwright` dependency (`ERR_MODULE_NOT_FOUND`).

Update (8-seat portrait side-seat clipping fix):
- Adjusted the 8-seat portrait `PORTRAIT_SEATS` side-middle coordinates in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - left/right pair moved from `x: 4 / 96` to `x: 11 / 89`
  - keeps the two side nameplates inside the viewport while preserving rail alignment
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=11` to `?v=12`

Validation:
- Reproduced the clipping issue in a mobile Playwright viewport using the real `online-table.html` styles and injected 8-seat sample nodes.
- Verified the adjusted coordinates visually keep the side-middle seats fully visible on portrait mobile.
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node "$WEB_GAME_CLIENT" --url http://127.0.0.1:8000/online-table.html --actions-json '{"steps":[{"buttons":[],"frames":1}]}' --iterations 1 --pause-ms 200` (pass)

Correction (actual seated 8-player portrait path):
- Confirmed the live issue for a seated player on an 8-player portrait table comes from the `7`-seat `PORTRAIT_SEATS` map, because `renderSeats()` hides `mySeat` on-table and reflows the remaining visible seats using `tableTotal`.
- Adjusted the 7-seat side-middle coordinates in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - left/right pair moved from `x: -2 / 102` to `x: 11 / 89`
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=12` to `?v=13`

Validation:
- Reproduced the exact clipping issue in a 390x844 portrait viewport using the 7-seat portrait map.
- Verified visually that the updated 7-seat side-middle positions are fully inside the viewport and still aligned to the rail.

Update (remove in-table Sit action):
- Removed the empty-seat `Sit` action from `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Empty seats now display `OPEN` instead of `SIT`.
- Only a managing host can tap an empty seat to open a popover, and that popover now contains only `Add Bot`.
- Removed the unused `.pop-sit` styling from `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=13` to `?v=14`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Verified source no longer contains `sitSelectedSeat`, `pop-sit`, or `SIT`/`Sit` empty-seat labels.
- Created a local online table as host, clicked an empty seat, and confirmed the popover shows only `Add Bot`.

Update (online seat-name mapping fix):
- Root cause confirmed in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`:
  - `online_get_table_state_viewer(...)` and `online_get_table_state(...)` were returning raw `online_table_seats` rows with `seat_token` stripped, but without joining `group_players` to include `player_name`.
  - In `/Users/abishek/Documents/poker-buyins/online/table_app.js`, `seatName()` falls back to `Seat N` when neither `seat.player_name` nor `hand_player.player_name` is present, which made joined players appear as `Seat 1`, `Seat 2`, etc. on existing tables.
- Patched both table-state functions to join `group_players` and include `player_name` on each seat row while still omitting `seat_token`.

Validation:
- Verified both table-state functions now append `jsonb_build_object('player_name', gp.name)` to seat payloads.
- Note: this fix requires re-running `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` against the Supabase database before the live app will reflect the change.
- Left the temporary verification table after the check.

Update (landing Join table split into Home / Online):
- Reworked the landing-page join modal in `/Users/abishek/Documents/poker-buyins/index.html`, `/Users/abishek/Documents/poker-buyins/styles.css`, and `/Users/abishek/Documents/poker-buyins/app.js`.
- New first step presents `Home` and `Online` buttons.
- `Home` keeps the existing in-person join behavior:
  - name prompt
  - active home-game lookup
  - fallback to join-by-code
- `Online` now:
  - shows a list of open joinable online tables (`waiting`/`active`, excluding full tables)
  - prompts for the player's name after a table is selected
  - joins via `online_ensure_lobby_player` + `online_join_table`
  - redirects to `online-table.html?table=...`
- Bumped landing-page asset cache busters in `/Users/abishek/Documents/poker-buyins/index.html`:
  - `styles.css?v=20260306a`
  - `app.js?v=20260306a`

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/app.js` (pass)
- Browser smoke test on `http://localhost:8000/index.html?cb=join-flow`:
  - `Join table` opens `Home` / `Online` chooser
  - `Home` routes to the existing name step and code fallback flow
  - `Online` shows open online tables with seat counts and blind info
  - selecting an online table prompts for name, joins successfully, and redirects to the online table view
- Left the joined online table after the end-to-end check.
