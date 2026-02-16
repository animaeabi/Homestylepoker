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
