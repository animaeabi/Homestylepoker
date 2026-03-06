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

Update (online table drama + card dealing pass):
- Upgraded `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js` to make the online table feel more like a live poker table:
  - Added a chip-stack pot display with live/hot/monster pot states instead of plain `Pot $X` text.
  - Added a visible deck source on the table and a dedicated `deal-fx-layer`.
  - Added real card-flight animation from the deck to each player in two rounds on new hands.
  - Opponents now hold facedown cards during active hands even when viewer-safe RPC payloads mask their hole cards.
  - Reworked the portrait `my-hand` area into a more held/fanned layout with larger cards.
  - Added stronger showdown/all-in visual treatment via pot pulse and win-reason banner styling.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=18` to `?v=20`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Ran the web-game Playwright client against local `online-table.html` after the changes.
- Browser-verified on a 430x932 viewport:
  - fresh table creation
  - add bot
  - deal new hand
  - confirmed `.deal-flight-card` count reached `4` during the opening deal
  - confirmed opponent held-card backs render on portrait (`.floating-cards .card` count `2`)
  - confirmed my-hand cards render (`#myHandCards .card` count `2`)
  - captured live screenshots showing the chip-stack pot, visible deck, in-flight dealer cards, and the final resting held-card layout.

Update (pot + my-hand tone-down pass):
- Simplified the pot treatment in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - removed the large dark capsule background
  - reduced chip-stack art size
  - kept only a lighter `chips + amount` readout with subtle hot/monster emphasis
- Reduced the prominence of the portrait my-hand tray:
  - smaller background tray
  - smaller card sizes and overlap
  - less aggressive negative top margin so the hand sits more naturally above the action bar

Validation:
- Browser-verified on a 430x932 viewport after creating a fresh table and dealing a hand.
- Confirmed the pot reads lighter on felt and the player cards/tray take up less space visually.

Update (pot realism + seat card anchoring pass):
- Reworked the pot visual in `/Users/abishek/Documents/poker-buyins/online-table.html` from a flat stack image into layered CSS poker chips, so it reads like chips on felt instead of a badge/image.
- Replaced the online card-back / deck / deal-flight styling with a burgundy-and-gold casino back design.
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` seat-card anchoring logic:
  - portrait opponent cards now anchor directly from seat position
  - split bottom seats into `bottom-left` / `bottom-right` layouts
  - left/right/top seat cards now sit neatly beside or just below their players instead of drifting toward center
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=20` to `?v=21`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Fresh 4-seat browser verification on a 430x932 viewport:
  - created table
  - added 3 bots
  - dealt a hand
  - confirmed 3 floating opponent card pairs rendered
  - confirmed the updated burgundy card-back background applied
  - verified visually that card pairs sit adjacent to player seats and the pot now reads as actual chips.

Update (dynamic pot growth + winner chip push pass):
- Reworked the pot in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html` so the chip stack is generated dynamically from `pot_total` instead of staying visually static.
- Added pot growth behavior:
  - chip count increases as the pot grows
  - new chips animate into the stack
  - the stack and amount pulse when new money enters the pot
- Added settlement payout FX:
  - when a hand settles, chip tokens now animate from the pot to the winning seat / my-hand rail
  - pot UI softens during payout so the chip push reads clearly
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=21` to `?v=22`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- 2-seat browser verification on a 430x932 viewport:
  - created table
  - added bot
  - dealt hand
  - called preflop and confirmed pot increased from `$3` to `$4`
  - confirmed dynamic pot chip count updated
  - folded on flop and confirmed `.pot-push-chip` elements rendered during settlement payout
  - verified `pot-paying` state activated while chips pushed to the winner.

Update (online seat-name mapping fix):
- Root cause confirmed in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`:
  - `online_get_table_state_viewer(...)` and `online_get_table_state(...)` were returning raw `online_table_seats` rows with `seat_token` stripped, but without joining `group_players` to include `player_name`.
  - In `/Users/abishek/Documents/poker-buyins/online/table_app.js`, `seatName()` falls back to `Seat N` when neither `seat.player_name` nor `hand_player.player_name` is present, which made joined players appear as `Seat 1`, `Seat 2`, etc. on existing tables.
- Patched both table-state functions to join `group_players` and include `player_name` on each seat row while still omitting `seat_token`.

Validation:
- Verified both table-state functions now append `jsonb_build_object('player_name', gp.name)` to seat payloads.
- Note: this fix requires re-running `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` against the Supabase database before the live app will reflect the change.

Update (portrait opponent card "held" layout):
- Reworked portrait opponent hole cards in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - Floating cards now classify each visible opponent seat as `top`, `left`, `right`, or `bottom` based on the seat's position relative to table center.
  - Cards are anchored with seat-aware posture instead of a single generic mini-card placement.
  - Revealed opponent cards now add a `showdown` class so showdown cards stay slightly larger.
- Updated portrait floating-card styles in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - Increased opponent card size from `22x30` to `28x38`.
  - Showdown reveal size increased to `30x42`.
  - Added tighter overlap and seat-direction fan angles to make cards read as if each player is holding them.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=14` to `?v=15`.

Update (held cards now deal in sequentially):
- Added a real client-side deal animation in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - When a new hand enters `preflop`, the client records the hand id and computes a deal order from the active seated players using `button_seat`.
  - Opponent seat cards and the player's own hand now receive a short staggered `--deal-delay` so cards appear in seat order instead of popping in simultaneously.
- Covered the first-hand edge case too:
  - if the table previously had no active hand and then the first visible `preflop` hand arrives, the already-connected clients still get the held-card deal animation.
- Added CSS deal-in animations in `/Users/abishek/Documents/poker-buyins/online-table.html` for:
  - `.floating-cards.dealing`
  - `.seat-cards-row.dealing`
  - `.my-hand-cards.dealing`
- Portrait floating cards now animate from table-center direction into their held posture.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=15` to `?v=16`.

Update (host recovery after host leaves):
- Root cause identified for stuck open tables after the original host leaves:
  - host transfer could strand `created_by_group_player_id` on a bot seat or otherwise leave the table without a recoverable human host
  - new joiners then had no `Deal` control even though the table still appeared open
- Added server-side recovery helpers in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`:
  - `online_active_human_host_group_player(...)`
  - `online_first_active_human_group_player(...)`
  - `online_prune_bot_seats(...)`
- Updated SQL behavior:
  - `online_table_seats` now has `is_bot boolean not null default false`
  - `online_join_table(...)` accepts `p_is_bot boolean default false`
  - bots are pruned when the host leaves so host authority cannot get stranded on local-only bot seats
  - host recovery now reassigns to the first active human seat, or leaves host null for the next human claimant if needed
  - human joins recover stuck tables by re-establishing a valid human host when none exists
- Updated `/Users/abishek/Documents/poker-buyins/online/client.js` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - bot joins now pass `isBot: true`
  - UI host checks now use an effective-host fallback based on the first active non-bot seat, so a recoverable human can see `Deal`
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=16` to `?v=17`.

Update (showdown winner text fix):
- Investigated live hand data for `Crimson Draw`, hand #2:
  - board: `6d 3s 4d 9d 8s`
  - `Abishek` had `Ac 7c` and received only `+3` back
  - `Bot Chip` had `Jd Kd` and won the actual showdown with a king-high flush for `+401`
- Root cause in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - the UI used the first non-folded player with `result_amount > 0` as the showdown winner
  - that breaks whenever someone receives a positive refund / side-pot return without actually having the best hand
- Added showdown leader detection based on actual hand strength using `describeSevenCardHand(...)` tuple comparison.
- Updated the UI to use showdown leaders for:
  - final win-reason text under the board
  - showdown card reveal logic
  - gold winner-seat highlight
- Payout amount badges still show for all positive-result seats, so returned excess chips are still visible without falsely marking that player as the hand winner.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=17` to `?v=18`.
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

Update (pot clear during payout animation):
- Refined the center pot layout in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - `Pot` label now sits above the chip/value row
  - added `.pot-main` for cleaner stack + amount alignment across breakpoints
  - added `.pot-cleared` styling so the center stack disappears while the pot is being scooped
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - payout launch now immediately forces the center pot display to `$0`
  - remembered the just-paid hand id so the settled hand keeps an empty pot instead of flashing the old amount back
  - cleared-pot state resets when a new hand arrives
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=22` to `?v=23`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Ran the develop-web-game Playwright client against `http://127.0.0.1:8000/index.html` and inspected the generated screenshot.
- Browser-validated a live hand on `online-table.html`:
  - during payout animation the center pot read `$0`
  - `.pot-cleared` hid the center stack while `.pot-push-chip` elements animated to the winner
  - after animation the payout chips were gone and the settled hand still showed an empty center pot
  - confirmed the `Pot` label sits above the chip/value row

Update (pot vertical stack alignment pass):
- Refined `/Users/abishek/Documents/poker-buyins/online-table.html` so the center pot is now a true vertical stack:
  - `Pot`
  - chip stack
  - value
- Removed the intermediate horizontal pot row wrapper so the chips no longer sit beside the amount.
- Made the `Pot` label more readable without changing its size by increasing contrast, weight, and text shadow.

Validation:
- Browser-validated on a live table:
  - `Pot`, chips, and amount are vertically ordered in that sequence
  - all three share the same horizontal center line
  - the amount still updates normally during a live hand

Update (all-in vs buy-in control fix):
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` so the player CTA in both the on-table seat view and the my-hand tray now uses real hand state instead of raw `stack == 0`.
- Added a shared stack-CTA decision helper with three outcomes:
  - active all-in hand: show `All-in`
  - between hands at `0`: show `Buy In`
  - between hands on a short stack: show `Top Up`
- Added `/Users/abishek/Documents/poker-buyins/online-table.html` styling for the non-clickable all-in status pill.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=23` to `?v=24`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-validated on a live hand:
  - clicked `All-in`
  - my-hand stack dropped to `$0` during the active hand
  - the control showed `All-in` with `seat-status-chip` styling
  - the control was visible but disabled, so rebuy was not offered mid-hand

Update (heads-up portrait seat spacing fix):
- Adjusted the 2-player portrait seat map in `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Heads-up portrait tables now place the visible opponent on the top rail instead of the left-middle lane, which clears the board corridor and prevents the seat/cards from crowding the community cards.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=24` to `?v=25`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-validated on the live 2-seat table:
  - opponent seat centered on the top rail
  - opponent held cards remained centered under that seat
  - large vertical gap remained between opponent cards and the board row

Update (uncontested pot message + hidden cards fix):
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` so uncontested pots no longer fall through the showdown path.
- Added explicit client helpers for:
  - uncontested winner detection
  - contested showdown detection
- Behavior change for single-player-win situations after everyone else folds:
  - winner text now reads `X wins the pot`
  - winner cards stay hidden
  - no showdown reveal styling is applied
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=25` to `?v=26`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-validated on a live foldout hand:
  - win-reason text became `Bot Dash wins the pot`
  - opponent floating cards remained `card-back`
  - `.floating-cards.showdown` was not applied

Update (compact custom bet/raise amount controls):
- Reused the existing online bet controls in `/Users/abishek/Documents/poker-buyins/online/table_app.js` instead of redesigning the action bar.
- Added shared bet-control helpers for:
  - legal min/max calculation
  - chip-step precision based on blind decimals
  - clamping and sync across slider, desktop amount input, portrait quick input, and preset buttons
- Added a compact portrait amount control in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - preset row now shows `Bet $` or `Raise to $` plus a small custom numeric input
  - preserves the existing primary action buttons with minimal layout change
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=26` to `?v=27`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-validated at 430x932 on a live table:
  - portrait preset row showed `Raise to $` with a compact amount field
  - quick amount input synced to the hidden desktop amount input and slider
  - typing a custom value updated all controls consistently

Update (my-hand D / SB / BB badge containment fix):
- Updated `/Users/abishek/Documents/poker-buyins/online-table.html` so the main player tray uses a safe inline badge layout for `D`, `SB`, and `BB`.
- Reset the my-hand badge chips away from the portrait seat-level absolute positioning that was pushing them off the right edge.
- Kept the seat badge styling on the table unchanged; the reset only applies inside `.my-hand-badges`.

Validation:
- Browser-validated on the live table with `D` and `SB` active in the my-hand tray.
- Measured badge geometry and confirmed both chips stayed fully inside `/Users/abishek/Documents/poker-buyins/online-table.html#myHandNameplate`.
