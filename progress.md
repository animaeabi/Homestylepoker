Original prompt: ok lets do it

## Current Project Map (2026-03-12)

### Product shape
- This codebase supports two products:
  - in-person poker buy-in / settlement tracking
  - online multiplayer Texas Hold'em
- The online mode must not break or pollute the in-person tracker.
- `__online_lobby__` is a hidden system group and must stay filtered from the in-person UI.

### Current architecture boundaries
- In-person app:
  - `/Users/abishek/Documents/poker-buyins/index.html`
  - `/Users/abishek/Documents/poker-buyins/app.js`
  - `/Users/abishek/Documents/poker-buyins/styles.css`
- Online frontend:
  - `/Users/abishek/Documents/poker-buyins/online-table.html`
  - `/Users/abishek/Documents/poker-buyins/online/table_app.js`
  - `/Users/abishek/Documents/poker-buyins/online/client.js`
  - `/Users/abishek/Documents/poker-buyins/online/showdown.js`
- Online backend:
  - `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/online-voice-session/index.ts`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.ts`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/showdown.ts`

### Production authority model
- Production gameplay is server-driven.
- `online-runtime-tick` is authoritative for:
  - bot actions
  - timeout folds/checks
  - all-in board runouts
  - showdown settlement
  - due-table auto-deal starts
- `/Users/abishek/Documents/poker-buyins/online/runtime_worker.js` is legacy/dev-only now.
- Viewer-safe table reads come from `online_get_table_state_viewer(...)`.
- Seat tokens remain required for all player mutations.

### Current online UX features
- Landing page Online accordion creates and seats a player directly.
- Join-by-link flow works through `online-table.html?table=UUID`.
- Host can add bots, remove bots, transfer host, and manage seated players.
- Hero has:
  - compact action rail
  - pre-actions
  - manual post-hand `Show Cards`
  - rebuy / top-up CTAs
- Hand log is floating, narrow, scrollable, and detailed.
- Table chat persists by table and late joiners can see earlier messages.
- Voice is currently shared-room table voice:
  - host enables/ends table voice
  - seated humans join/leave
  - Daily-backed room/tokens via `online-voice-session`
- Bots are server-side and use opponent profiling.

### Current high-signal behavior guarantees
- Winner banner should appear, hang, then auto-deal countdown starts.
- Timeout checks are automatic when checking is free; only facing a live bet causes timeout fold.
- Dead-chip overcalls should not expose meaningless extra all-in controls.
- Showdown in all-in runouts reveals all eligible all-in players, while normal showdowns stay more selective.
- Manual `Show Cards` exists only after settlement.
- Hand shuffles now use a cryptographically secure Fisher-Yates source.
- Client-facing hand state no longer exposes the live undealt deck.
- Remaining undealt deck state can now be stored encrypted at rest while keeping the one-shuffle physical dealing model and deck commitment metadata.
- Online ops now have a dedicated runtime health probe and a repeatable browser smoke harness for quick regression checks.

### Known operational caution
- Voice functionality exists, but cross-device/iPhone verification should always be treated as manual QA territory before assuming it is stable.
- No RLS is enabled yet; security is still RPC-check driven.
- Runtime cron dispatch is now intended to use a vault-backed anon key plus a private `ONLINE_RUNTIME_DISPATCH_SECRET` header; direct public invocation of the runtime edge function should be treated as a bug.

### New UI/social polish (2026-03-12)
- Added stronger turn prominence in the online table:
  - global turn indicator banner
  - stronger active-turn seat/hero glow
- Added stronger winner prominence:
  - richer winner popup glow
  - stronger winner seat/hero highlight treatment
- Added ephemeral post-hand reactions for seated human players only:
  - no bot reactions
  - no DB/schema change
  - reactions are broadcast-only over the existing table chat realtime channel
  - current presets: `Well played`, `Nice bluff`, `Laugh`, `Angry`
  - reaction tray is shown only to human players who were live in the settled hand
  - reaction bubbles are short-lived and intentionally not stored in chat/history

### Best files for a new AI to read first
1. `/Users/abishek/Documents/poker-buyins/AGENTS.md`
2. `/Users/abishek/Documents/poker-buyins/progress.md`
3. `/Users/abishek/Documents/poker-buyins/online/table_app.js`
4. `/Users/abishek/Documents/poker-buyins/online-table.html`
5. `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
6. `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts`

## Recent High-Signal Fixes
- `local / applied + validated`:
  - added `online_runtime_health_check(limit, grace_secs)` in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
  - added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260313101000_add_runtime_health_check.sql`
  - validated live with a service-role RPC call showing:
    - `dispatch_ready: true`
    - `processable_count: 0`
    - `due_table_count: 0`
    - `stale_hand_count: 0`
- `local / automation harness`:
  - added `/Users/abishek/Documents/poker-buyins/scripts/check_online_runtime_health.mjs`
    - service-role CLI check for runtime dispatch readiness and stale hands
    - optional `--repair` path dispatches one runtime tick and rechecks
  - added `/Users/abishek/Documents/poker-buyins/scripts/web_smoke.mjs`
    - launches Chromium
    - opens the landing page
    - creates an online table
    - verifies the table boots with `Deal`
    - leaves the table
    - verifies `Online Games` still opens
    - stores screenshots under `/Users/abishek/Documents/poker-buyins/output/web-smoke/`
  - added `/Users/abishek/Documents/poker-buyins/scripts/online_ui_smoke.mjs`
    - dedicated online poker UI smoke run
    - validates top-bar shell, settings, hand log, chat, bot add flow, `Deal`, and the hero action rail
    - stores screenshots under `/Users/abishek/Documents/poker-buyins/output/online-ui-smoke/`
  - added `/Users/abishek/Documents/poker-buyins/docs/ONLINE_AUTOMATION.md`
  - added `/Users/abishek/Documents/poker-buyins/package.json` with:
    - `npm run check:runtime`
    - `npm run smoke:web`
    - `npm run smoke:online-ui`
    - `npm run smoke:all`
  - local validation run completed successfully for:
    - `npm run smoke:web`
    - `npm run smoke:online-ui`
- `local / unpushed`:
  - fixed hero pre-action gating so `Check/Fold` / `Call Any` do not reappear after the hero has already acted on the current street
  - suppressed active-turn highlight during presentation beats so the ring does not jump early to the next actor during action acknowledgment / street reveal
  - validated with:
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js`
- `dd2a6a0`:
  - upgraded the per-hand shuffle path to a `pgcrypto`-backed Fisher-Yates source
  - stamped each hand with `deck_commitment` and `rng_seed_hash`
  - removed `deck_cards` from viewer-safe hand payloads so clients cannot inspect the undealt deck
- `local / applied to Supabase, not yet pushed in git`:
  - added encrypted undealt-deck storage at rest via `online_private.pack_remaining_deck(...)` / `online_private.unpack_remaining_deck(...)`
  - added `online_hands.deck_cards_encrypted`
  - updated `online_start_hand(...)`, `online_submit_action(...)`, and `online_advance_hand(...)` to pack/decrypt/repack the remaining deck while preserving one-shuffle + burn-card dealing
  - updated `online_get_hand_state_viewer(...)` to strip both `deck_cards` and `deck_cards_encrypted`
  - added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260312154500_encrypt_remaining_deck_at_rest.sql`
  - applied with `supabase db push`
  - rollout note:
    - full at-rest protection requires a trusted secret named `online_deck_crypto_key`
    - lookup order is `vault.decrypted_secrets` first, then `app.settings.online_deck_crypto_key`
    - if no key is configured, runtime falls back to plaintext `deck_cards` for compatibility
- `local / rolling out now`:
  - removed the hardcoded anon JWT from `online_dispatch_edge_runtime()`
  - runtime cron dispatch now pulls `SUPABASE_ANON_KEY` from Supabase secrets / vault
  - added a private header gate using `ONLINE_RUNTIME_DISPATCH_SECRET`
  - `online-runtime-tick` now rejects requests without that secret
  - added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260312164000_harden_runtime_dispatch_secret.sql`
  - old bootstrap migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260309200000_move_online_runtime_off_host.sql` was also sanitized so fresh installs do not reintroduce the hardcoded token
- `4cb29a9`:
  - fixed river/showdown event ordering so the last river action is written before `showdown_ready`
  - historical bad hand logs remain bad; new hands should be correct
- `7b97772`:
  - winner banner timing now uses a local visible hold
  - prevents the banner from “using up” its hang time before the client sees it
- `d15a78e`:
  - stabilized post-hand `Show Cards` with dedicated pending/override state
  - stopped the button from blinking and swallowing taps during background polling
- `920dc86`:
  - fixed settled-hand hero UI leak where `Show Cards` could coexist with stale `Check`
  - made `Show Cards` an exclusive settled render path
- local uncommitted changes:
  - turn indicator + stronger winner emphasis + ephemeral player reactions added to the online table UI
  - cache buster advanced to `v=177`
  - validated with:
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js`
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_fx_geometry.js`
    - local browser smoke with no console errors
    - develop-web-game harness output at `/Users/abishek/Documents/poker-buyins/output/web-game-reactions/shot-0.png`

### Current online bundle note
- `/Users/abishek/Documents/poker-buyins/online-table.html` currently loads `/Users/abishek/Documents/poker-buyins/online/table_app.js?v=177`
- If online UI changes do not appear on device, check the cache-buster first

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
  
Update (timer + player management pass):
- Moved the active turn countdown fully into the avatar ring in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Added overtime pulse once a player’s timer reaches 0; warning tick sound now only plays for the acting player.
- Added a `Players` section to the online settings panel showing seated players only, with host-only controls to remove stuck players and transfer host rights.
- Added RPC wrappers in `/Users/abishek/Documents/poker-buyins/online/client.js`.
- Added backend RPCs and migration for host-managed seat removal / host transfer:
  - `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
  - `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260309190500_add_host_player_management.sql`
- Applied the migration with `supabase db push`.

Notes:
- Deliberately did not implement “any player can kick any player” or a seat double-tap eject shortcut because that is too easy to abuse on a live table.
- Recommended next step if needed: add a host-only quick seat action shortcut on occupied seats, reusing the same host-authorized RPCs.
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

Update (show-cards settled UI cleanup):
- Fixed a settled-hand hero UI leak where `Show Cards` could still coexist with a stale `Check` button after all-in / everyone-folded finishes.
- Made `Show Cards` an exclusive early render path in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so live-action and pre-action button state can no longer re-expose the hero call/check control during settled hands.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache key to `v=173`.

Update (handoff documentation refresh):
- Rewrote `/Users/abishek/Documents/poker-buyins/AGENTS.md` to match the current production project shape instead of older assumptions.
- Added a current-state project map and recent high-signal fixes section near the top of `/Users/abishek/Documents/poker-buyins/progress.md`.
- The refreshed docs now correctly describe:
  - server-side runtime authority
  - viewer-safe state reads
  - shared-room table voice
  - hero pre-actions and post-hand `Show Cards`
  - current online entry points and guardrails

Update (showdown payout UX pass):
- Adjusted `/Users/abishek/Documents/poker-buyins/online/table_app.js` so settlement seat tags show net winnings (`result_amount - committed`) instead of gross payout returns, preventing false positive tags for players who only received their own chips back from side-pot resolution.
- Delayed settlement FX (win overlays, pot push, victory popup) until pending street reveal animation finishes, so turn/river board cards are visually dealt and flipped before chips/results appear.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=118`.

Update (hand-log depth + pot simplification pass):
- Simplified the felt pot UI in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so side-pot pills are no longer shown beside the central pot.
- Expanded the floating hand log in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - preserves user scroll while live events continue instead of forcing auto-scroll every update
  - adds richer showdown settlement entries for:
    - main/side pot winners
    - payout amounts
    - shown hole cards + made hand labels
  - keeps burn actions visible but intentionally does not reveal the hidden burn-card face, to preserve real poker information boundaries
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=121`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Local Playwright smoke capture against `http://127.0.0.1:8000/online-table.html?table=be265f73-02dc-4c0b-89b2-462d7e8d9a6e` completed; latest screenshot: `/Users/abishek/Documents/poker-buyins/output/web-game-fix/shot-0.png`
  - Aims to prevent overlap and keep table readable on portrait screens.

Update (hero pre-action rail):
- Replaced the rejected separate pre-action row with the existing vertical hero action rail in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Waiting-state rail now uses the same three action slots:
  - `Check/Fold`
  - `Check`
  - `Call Any`
- On the hero turn, that same rail transforms back into the live action buttons:
  - `Fold`
  - `Check` / `Call $X`
  - `Bet` / `Raise`
- Pre-actions are client-local, scoped to the current hand + street, auto-clear on street/hand change, and auto-fire only when the hero's turn arrives and the action is still legal.
- `Check` auto-cancels if the spot is no longer checkable before action reaches the hero.
- Lowered the compact hero action rail a bit more and added disabled styling for unavailable pre-actions.
- Pre-actions now render as neutral checkbox-style choices on the same rail, and the fold slot explicitly resets to `Fold` when the hero's live turn begins.
- Lowered the hero action chip so it sits closer to the hero cards, and SB/BB badges now clear once a player has folded out of the hand after posting.
- Bundle bumped to `v=129`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)

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

Update (board reveal animation cleanup pass):
- Reworked community-card reveal pacing in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - flop now reveals one card at a time instead of grouped land/flip behavior
  - turn and river use the same sequential land -> flip -> breath sequence
  - board underlay cards stay hidden until the flying reveal card has effectively finished the flip, eliminating the double-show/glitch handoff
- Tightened reveal CSS in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - slower, cleaner hover-and-settle landing
  - later ghost-out of the flying FX card
  - smoother underlay fade-in once the reveal completes
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=144`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Local browser smoke against `http://127.0.0.1:8000/online-table.html` returned clean HTML and no new script/runtime output from the Playwright loop.

Update (street-action sync guard pass):
- Added a strict street-reveal presentation lock in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so hero action controls do not appear while a new board card is still revealing.
- Applied that lock to:
  - turn action-rail eligibility
  - pre-action mode eligibility
  - "Your turn" toast timing
- Updated street reveal cleanup to call `renderAll()` (not just `renderBoard()`) so controls re-enable exactly when reveal completes, avoiding stale hidden/action mismatch windows.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=145`.

Update (capped all-in control pass):
- Tightened dead-chip aggression rules in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` so a player only gets bet/raise/all-in controls when another live player can actually contest chips above the current bet.
- Added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260311201000_disallow_dead_allin_overcalls.sql`.
- Result: when a shorter stack has already capped the action, deeper stacks only get `Call`, not a meaningless extra `All-in`.

Update (post-hand action rail visibility fix):
- Fixed a mobile CSS regression in `/Users/abishek/Documents/poker-buyins/online-table.html` where `.astrip-allin` could override the generic `.hidden` class and leak the `All-in` button during post-hand `Show Cards` mode.
- Added explicit hidden-state enforcement for action-strip buttons/groups so only the intended post-hand controls remain visible.

Update (pre-action cleanup + auto-deal countdown pass):
- Removed the ugly `Call $0` pre-action state in `/Users/abishek/Documents/poker-buyins/online/table_app.js`; the middle pre-action slot now stays hidden unless there is an actual bet to call.
- Added a subtle auto-deal countdown treatment on the center `Deal` button in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`, reusing the existing showdown hang-time window with a soft fill/progress effect and `Dealing in N` label.

Update (countdown tone-down pass):
- Reduced the visual prominence of the auto-deal countdown label in `/Users/abishek/Documents/poker-buyins/online-table.html`, especially for portrait/iPhone layouts, by shrinking the countdown text size and tightening the letter spacing while keeping the normal `Deal` button unchanged.

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

Update (online E2E hardening pass):
- Patched heads-up postflop first-to-act selection in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`:
  - Added `online_first_postflop_action_seat(...)`
  - Street transitions now use dealer/button first when only two actionable players remain
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - `online-runtime-tick` is now host-only from the client, so observer/guest tabs stop driving the runtime loop
  - Added table boot overlay state for same-device rejoin / direct-link entry
  - Suppressed placeholder top-bar text during booting
- Updated `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - Added loading shell overlay (`Loading Table...`) for rejoin/direct open
  - Replaced non-standard `slider-vertical` styling with standards-safe vertical range styling
  - Bumped table app cache buster to `v=46`

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Playwright local browser check:
  - loading overlay shows immediately on table open/rejoin
  - console warnings for vertical slider styling are gone
  - guest-side network no longer repeatedly calls `online-runtime-tick`
- Heads-up postflop actor fix is patched in repo but still needs the SQL migration applied to the live Supabase backend before browser E2E can confirm it.

- 2026-03-08: Added immediate turn-action UI cleanup in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - action buttons now hide as soon as a hand action is submitted
  - controls stay hidden until the next table-state refresh lands
  - failures restore the controls so the player is not stuck
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=47`

- 2026-03-08: Fixed heads-up seat badge overlap in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - grouped `D`, `SB`, and `BB` into a shared seat badge row
  - compact portrait and landscape seat layouts now place the badge row together instead of stacking both labels on the same top-right corner
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=48`

- 2026-03-08: Adjusted compact seat badge placement in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - moved compact `D/SB/BB` badge rows into the seat header flow so they no longer overlap avatars
  - stacked compact seat header content vertically for cleaner heads-up seats
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=49`

- 2026-03-08: Moved compact opponent cards to a seat-attached stack in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - compact opponent cards now sit above the seat card instead of floating across the stack text
  - avatar, name, stack, and role chips stay readable under the cards
  - tuned separate portrait and landscape compact card sizes/offsets
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=50`

- 2026-03-08: Restored compact opponent card visibility in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - compact breakpoints now hide only non-compact seat card rows
  - `.seat-cards-row.compact-opponent` is explicitly shown in portrait and landscape compact modes

- 2026-03-09: Improved online turn flow and player convenience in:
  - `/Users/abishek/Documents/poker-buyins/online/table_app.js`
  - `/Users/abishek/Documents/poker-buyins/online-table.html`
  - `/Users/abishek/Documents/poker-buyins/online/client.js`
  - `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts`
  - `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260309234500_add_auto_check_preference.sql`
- Added seat-level `auto_check_when_available` preference with player-facing toggle in Preferences.
- Runtime tick now auto-checks for opted-in human players when `to_call = 0`, so the feature still works even if their browser is backgrounded.
- Hero seat now grays out when the player times out/folds, matching the table-seat folded treatment.
- Action announcements now prioritize the newest action and delay street reveals slightly longer so the last action is visible before the next street animation takes over.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/client.js` (pass)
- `supabase db push` (applied `20260309234500_add_auto_check_preference.sql`)
- `supabase functions deploy online-runtime-tick` (pass)
- Browser smoke check: Preferences panel shows the new auto-check toggle and updates successfully.
- Direct backend smoke check: in a 2-player table, BB with auto-check enabled auto-checked from the edge runtime after SB called, advancing hand from preflop to flop.
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=51`

- 2026-03-08: Made compact opponent card placement directional in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - top seats now place cards below the seat card, toward table center
  - side seats place cards inward from the rail
  - lower seats keep cards above the seat card
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=52`

- 2026-03-08: Reverted compact opponent cards to a hero-style held stack in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - compact opponent cards are centered above the seat/avatar again
  - lowered the stack so it stays visible while still reading as “held above the badge”
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=53`

- 2026-03-08: Nudged compact opponent card stacks upward in `/Users/abishek/Documents/poker-buyins/online-table.html`:
 - 2026-03-09: iPhone portrait hero-anchor adjustment in `/Users/abishek/Documents/poker-buyins/online-table.html`:
   - added Safari/iOS-specific portrait overrides so the hero stack sits closer to the bottom rail instead of floating inside the felt
   - lifted the portrait mic/chat floating buttons on iPhone so they stay above the browser toolbar / hand-log area
   - local smoke check via `$WEB_GAME_CLIENT` completed without new JS/runtime errors; screenshot artifacts landed under `/Users/abishek/Documents/poker-buyins/output/web-game`
 - 2026-03-09: join-time microphone permission prompt in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
   - manual Create/Join success now makes a best-effort `getUserMedia({ audio: true })` request so voice permission is asked before the player taps the mic
   - stream is stopped immediately after grant, so Daily voice does not auto-connect and should not consume minutes
   - intentionally skipped for passive auto-reentry because iOS/browser gesture requirements are unreliable there
 - 2026-03-09: iPhone chat keyboard viewport stabilization in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
   - while the chat textarea is focused, the app freezes `--app-vh` at the pre-keyboard height so the table no longer shrinks when the iOS keyboard opens
   - blur restores normal viewport syncing after the keyboard dismisses

- 2026-03-08: Retuned portrait iPhone table scaling in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - added viewport CSS vars sourced from `window.visualViewport` / screen metrics
  - changed portrait table sizing to use width-first clamping with a smaller reserve and overlap credit
  - tightened portrait table-area padding so the table can sit closer to edge-to-edge on real iPhones
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=84`

- 2026-03-08: Fixed the Daily voice state model in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - releasing the mic now stops speaking but keeps the player connected in the room as a listener
  - if the floor is busy, the player stays connected instead of being disconnected
  - this preserves push-to-talk while making remote audio actually hearable after a player has joined voice once
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=85`

- 2026-03-08: Corrected the iPhone portrait oversizing regression in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - viewport height now prefers `visualViewport.height` instead of taking the largest layout/screen height
  - reduced portrait overlap credit and tightened max-height guardrails so the table no longer shoves the hero seat up into the table on real iPhones
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=86`

- 2026-03-08: Realigned the portrait bottom anchors in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - idle hero seat (`.my-hand-area.no-hole-cards`) now sits lower so the nameplate lands on the rail instead of floating inside the felt
  - portrait mic/chat row moved higher above the browser toolbar and hand log
  - chat panel lifted with the fab row
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=87`

- 2026-03-09: Made the table chat panel draggable in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - chat header is now the drag handle on mouse/touch/pointer
  - panel position is clamped within the visible viewport
  - moved panel keeps its position while open and re-clamps on viewport resize
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=88`

- 2026-03-09: Lowered the active portrait hero stack in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - active hero `my-hand-area` bottom anchor moved down to the rail zone
  - reduced extra upward lift on hero cards so the cards + badge read closer to the reference layout
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=89`
  - portrait-only table sizing now favors width more on real phones instead of over-shrinking from `100dvh`
  - reduced the default portrait UI reserve and made it state-aware for hidden vs expanded top bar / action-open states
  - widened the portrait table cap from `92vw` to `96vw` and tightened table-area side/top padding
  - verified on a 430x932 portrait viewport that the table fills much more of the screen while still clearing hero seat, hand log, and utility buttons
  - Daily voice custom UI was joining rooms successfully but not rendering remote audio elements, so connected players could not hear one another
  - added hidden `voiceAudioRack` audio elements driven from Daily participant/track events in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`
  - simplified voice UX to true hold-to-talk: hold connects/talks, release disconnects
  - prevented iPhone long-press text selection/callouts on the mic button
  - chat button now hides while the floating chat panel is open
  - chat input uses iOS-safe font sizing to avoid Safari zoom on focus
  - cached voice session tokens client-side so repeated holds do not keep calling the Edge Function
  - relaxed Daily usage polling in the Edge Function so rate-limited usage checks fall back to cached/estimated values instead of 500ing voice joins
  - redeployed `supabase/functions/online-voice-session/index.ts` after the rate-limit fix
  - bumped the table script cache buster through `?v=83`
  - raised the centered held-card stack in both portrait and landscape compact modes
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=54`

- 2026-03-08: Raised compact opponent held-card stacks another step in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - moved the centered opponent card stack higher in portrait and compact landscape
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=55`

- 2026-03-08: Adjusted portrait 4-player side-seat positions in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - moved the left and right seats upward in the 4-player portrait map so they clear the board cards
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=56`

- 2026-03-08: Corrected compact portrait 4-player seat positioning in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - updated the `3-seat` portrait map used by compact mobile when the hero seat is hidden
  - moved the left and right visible seats upward so 4-player compact tables clear the board
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=57`

- 2026-03-08: Nudged compact portrait 4-player side seats higher in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - moved the left and right visible seats from `y: 52` to `y: 48` in the compact `3-seat` portrait map
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=58`

- 2026-03-08: Raised compact portrait 4-player side seats another step in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - moved the left and right visible seats from `y: 48` to `y: 44` in the compact `3-seat` portrait map
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=59`

- 2026-03-08: Pushed compact portrait 6-player lower side seats outward in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - updated the compact `5-seat` portrait map used when the hero seat is hidden in a 6-player game
  - moved the lower left/right seats from `x: 15/85` to `x: 10/90`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=60`

- 2026-03-08: Nudged compact portrait 6-player lower side seats outward again in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - moved the lower left/right seats from `x: 10/90` to `x: 8/92`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=61`

- 2026-03-08: Moved portrait board cards slightly upward in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - reduced portrait board-card top margin from `18px` to `12px`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=62`

- 2026-03-08: Moved the portrait center stack upward in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - raised `.table-center` from `top: 55%` to `top: 53%`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=63`

- 2026-03-08: Added showdown-only directional opponent card placement in compact layouts:
  - compact opponent cards keep the held-above-avatar look during normal play
  - at showdown, left-side seats reveal cards to the right, right-side seats reveal to the left, and the top seat reveals below the badge
  - updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=64`

- 2026-03-08: Cleaned up showdown card presentation in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - showdown cards now separate cleanly instead of keeping the held overlap
  - added a small staggered reveal animation for the two cards
  - increased compact showdown gap for clearer readability
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=65`

- 2026-03-08: Strengthened compact showdown card separation overrides in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - explicitly reset compact showdown first/last card transforms and overlap margins
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=66`

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

Update (portrait vertical actions + collapsible top bar pass):
- Implemented portrait-mode compact top bar behavior in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - Added portrait compact media detection.
  - Reused the existing top-bar toggle state so portrait can collapse/expand the full header from a small arrow button.
  - Preserved full header behavior on non-compact layouts.
- Matched portrait action behavior to landscape in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - Portrait now uses the same on-demand raise panel logic (`Bet/Raise` opens panel first, second click submits).
  - Preset/slider panel stays hidden until raise panel is opened, and closes on other actions.
- Updated portrait CSS in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - Top bar is hidden by default and expands via the small toggle control.
  - Action controls changed from horizontal strip to compact vertical stack.
  - Raise controls moved to a vertical companion panel (slider + presets) beside actions.
- Bumped cache buster in `/Users/abishek/Documents/poker-buyins/online-table.html` from `?v=37` to `?v=38`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node "$WEB_GAME_CLIENT" --url http://127.0.0.1:8000/online-table.html --actions-json '{"steps":[{"buttons":[],"frames":1}]}' --iterations 1 --pause-ms 200 --screenshot-dir output/web-game` (pass)
- Portrait Playwright visual checks:
  - Verified collapsed portrait top bar with only small toggle visible.
  - Verified expanded portrait top bar on toggle tap.
  - Verified portrait vertical action stack + vertical raise panel layout in viewport (forced visible for visual validation when not on-turn).

Update (real hand overlap verification + portrait spacing fix):
- Ran a real playable hand as host on table `b62bedd1-0074-4cb9-92ee-6eadb0d97385` in portrait (430x932).
- Confirmed issue: main player cards overlapped with action/raise controls, especially when raise panel opened.
- Adjusted portrait layout in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - During active-turn action state, `my-hand-area` shifts right (`#tableView.landscape-actions-visible .my-hand-area`) to avoid overlap with left-docked controls.
  - Raise panel moved from side-by-side with action stack to an upper-left position above action controls.
  - Tweaked raise panel dimensions/slider height to stay compact while preserving usability.

Validation:
- Replayed the same hand state and captured before/after screenshots.
- Verified both states are clear:
  - Action panel visible: cards and badge no longer overlap controls.
  - Raise panel open: cards remain fully readable and no panel collision.
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass).

Update (portrait idle seat rail alignment):
- Tightened the pre-deal portrait hero seat position in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Scoped change to `.my-hand-area.no-hole-cards` only, so it affects the join / before-deal state without changing active-hand spacing.
- Removed the extra nameplate top offset for that idle state and added an upward visual shift.

Validation:
- Created a fresh local table in portrait (`430x932`) and checked the idle screen before any hand was dealt.
- Measured hero badge gap from table rail reduced from about `96px` to `34px`.
- Visual check confirmed the main player now sits much closer to the table edge in the idle state.

Update (portrait idle black-space reduction):
- Reworked the portrait idle hero seat from flow-based spacing to absolute positioning in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- This removed the extra reserved space below the table and let the idle badge sit nearer the rail without affecting active-hand layout.

Validation:
- Rechecked the same fresh local table in portrait after the change.
- Idle hero seat now has about `47px` gap to the table rail with about `53px` clearance above the hand-log toggle.
- Visual check confirmed less empty black space below and a higher idle badge position.

Update (table viewport lock / no-scroll pass):
- Added `table-mode` viewport locking in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Table view now applies `overflow: hidden` to `html` and `body` only while the game screen is active.
- Set `#tableView` to fixed viewport height and added `min-height: 0` to the table flex area.
- Updated portrait table sizing to derive from available viewport height (`--portrait-ui-reserve`) so the table scales down instead of forcing page scroll.
- Bumped online table script cache buster from `v=38` to `v=39`.

Validation:
- Verified in portrait idle table and active dealt-hand state on a fresh local table.
- In both states:
  - `html/body` had `table-mode`
  - computed `overflow` was `hidden`
  - document `scrollHeight` matched viewport height
  - `canScroll` was `false`

Update (portrait action spacing + hero card size):
- Increased spacing between portrait action buttons in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Slightly reduced portrait main-player card size and holder footprint so the bottom area feels lighter.

Validation:
- Rechecked a live portrait hand locally after the CSS change.
- Verified the vertical action stack had more gap between buttons and the hero cards rendered slightly smaller while staying readable.

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

Update (landscape mobile parity pass):
- Ported the portrait online-table control treatment into the landscape-phone breakpoint in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Landscape mobile now mirrors the portrait flow more closely:
  - hides the on-table `my-seat`
  - shows the `my-hand` tray with the inline `D / SB / BB` badges
  - uses the portrait-style action buttons instead of the old thin docked bar
  - shows the compact `Bet $ / Raise to $` quick input in the preset row
  - keeps the pot styling and compact board spacing aligned with the portrait treatment
- Removed the old wide-screen bottom-right action docking behavior for the landscape phone breakpoint so the controls stay full-width and consistent with portrait.

Validation:
- Browser-validated at `932x430` on a live table:
  - `my-seat` was hidden on the table and the `my-hand` tray was visible
  - `D` and `SB` badges stayed fully inside the `my-hand` nameplate
  - landscape `Raise to $` quick input synced correctly with the hidden amount input and slider
  - main action buttons and preset row were visible together in the portrait-style bottom stack

Update (landscape portrait-parity correction):
- Tightened the landscape-phone implementation so it actually follows the portrait table language in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Landscape phone mode now:
  - hides the top metadata pills like portrait
  - uses the mahogany portrait-style table shell and felt texture instead of the old wide oval
  - filters the player's own seat out of the on-table layout so the remaining seats reflow like portrait
  - renders opponent held cards as portrait-style floating cards instead of inline seat cards
  - applies the portrait seat-card treatment in landscape, including hidden bot subtitles and gold stack styling
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=27` to `?v=28`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-validated in landscape on live 2-seat and 4-seat tables:
  - top metadata pills were hidden
  - my seat was removed from the table and shown only in the my-hand tray
  - opponents used floating held cards with no inline seat-card rows
  - the landscape table used the portrait mahogany shell rather than the old wide ellipse

Update (landscape wide-layout correction):
- Reworked the landscape-phone composition in `/Users/abishek/Documents/poker-buyins/online-table.html` so the portrait styling adapts to a wide screen instead of shrinking the table into the middle.
- Landscape now:
  - uses a full-width wide mahogany table shell again
  - keeps the portrait-style seat cards and floating held cards
  - moves the lower UI into a horizontal split: my-hand tray on the left, action controls on the right
  - removes the stacked bottom layout that was stealing too much table height
- Kept the `my-seat` hidden from the table itself and preserved the portrait-style action buttons and quick amount controls.

Validation:
- Browser-validated again at `932x430` on live 2-seat and 4-seat tables:
  - table filled the landscape width
  - lower UI no longer stacked vertically under the table
  - my-hand tray remained readable without crowding the felt
  - action controls stayed clear and aligned on the right

Update (landscape balance pass):
- Tuned the landscape-phone proportions again in `/Users/abishek/Documents/poker-buyins/online-table.html` after feedback that the center was still crowded.
- Adjustments:
  - moved top floating hole cards back toward the seat so they no longer cover the pot
  - nudged the center content slightly lower for more separation
  - centered the my-hand tray in its lane
  - reduced the landscape my-hand card size and overall action button scale
  - moved the `Deal` button lower so it sits beneath the board row
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=28` to `?v=29`.

Validation:
- Browser-validated at `932x430` on live 4-seat and 2-seat tables:
  - pot was no longer covered by the top seat cards
  - action strip and presets took less visual weight
  - my-hand tray was centered better within the left lane
  - `Deal` sat below the board cards on a fresh waiting table

Update (landscape deck hide):
- Hid the visual deck in the landscape-phone breakpoint in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Kept the deck element in layout with zero opacity so the deal animation origin still works correctly.

Validation:
- Browser-validated on a live landscape waiting table:
  - the deck graphic was no longer visible
  - the waiting-state `Deal` button remained in place

Update (landscape top-seat / pot spacing):
- Adjusted the landscape seat ellipse in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so top seats sit farther toward the rail.
- This specifically creates separation between the top seat and the center `Pot` label in landscape.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=29` to `?v=30`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-measured on a live landscape table:
  - top-seat to `Pot` label gap improved from about `-2px` overlap to about `8px`

Update (landscape density cleanup):
- Tightened the landscape-phone UI density in `/Users/abishek/Documents/poker-buyins/online-table.html` to reduce crowding:
  - slimmer bottom control lane and smaller action buttons
  - smaller my-hand cards/nameplate/badge chips
  - narrower left lane allocation for my-hand area
  - slightly lower table center and board spacing for cleaner visual hierarchy
  - moved top floating cards closer to the top seat so they clear the pot area better
  - reduced rail/border visual weight a bit for less heaviness

Validation:
- Browser-validated at `932x430` on the same live 4-seat landscape table:
  - center area no longer felt as crowded
  - bottom control cluster consumed less vertical/visual weight
  - top seat cards had clearer separation from pot label/chips/value

Update (landscape reference-style theme pass):
- Reworked the landscape-phone presentation in `/Users/abishek/Documents/poker-buyins/online-table.html` to closely match the provided premium reference style while preserving gameplay mechanics:
  - deeper cinematic table/background lighting
  - heavier mahogany rail with warm gold trim/glow
  - upgraded seat card treatment (larger circular avatars, stronger dark nameplates, gold accent chips for `D/SB/BB`)
  - centered, glossy bottom action rail and matching preset strip
  - refined pot/board hierarchy and chip stack styling
  - overlaid compact my-hand tray so the table keeps more visible area
- Adjusted landscape seat vertical spread in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so top seats fit better with the new visual scale.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` script cache buster from `?v=30` to `?v=31`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser-validated at `932x430` on the live table state used for previous regressions:
  - online actions/buttons remained functional
  - seat rendering and role chips remained functional
  - landscape visuals now align much closer to the reference tone/layout

Update (landscape fullscreen + pull-down top bar):
- Implemented an auto-collapsed landscape control bar in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - the top bar (`hamburger`, table name, copy link/remove bots/leave) now starts hidden in landscape-phone mode
  - added a compact pull-down handle (`▼/▲`) to expand/collapse controls on demand
  - expanding the controls shifts table padding down to avoid overlap; collapsing reclaims full table space
- Continued landscape declutter pass:
  - reduced seat card and action-button density
  - rebalanced board/pot vertical spacing
  - adjusted my-hand area behavior so waiting states no longer render dark placeholder cards
  - my-hand tray now sits lower when actions are hidden, and lifts only when action controls are visible
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` script cache buster from `?v=31` to `?v=32`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Playwright MCP visual validation at `932x430` on live table URL:
  - collapsed state: top bar hidden, only pull-down handle visible, table uses more viewport
  - expanded state: top bar appears cleanly and remains functional
  - waiting state no longer shows black/my-card placeholder block over the board area

Update (landscape breathing-space geometry pass):
- Adjusted landscape table composition in `/Users/abishek/Documents/poker-buyins/online-table.html` to reduce center clutter:
  - table footprint reduced (`width ~96%`, `height ~90%`, capped max-height) for more breathing room
  - board card size reduced and board row moved upward
  - pot label/chips/value moved upward with tighter vertical rhythm
  - seat card dimensions slightly reduced for cleaner center clearance
- Adjusted landscape seat ellipse in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - seats now sit farther toward the table edge (more casino-like rail alignment)
- Bumped script cache buster from `?v=32` to `?v=33`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Playwright MCP visual validation at `932x430`:
  - center board/pot area has more separation from the hero badge and nearby side seats
  - seats are pushed outward toward the rail in landscape

Update (landscape main-hand anti-clutter pass):
- Increased hero hand clearance only during active-turn landscape mode in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - raised `.my-hand-area` when actions are visible
  - reduced hero card + nameplate footprint while action bar is visible
- Goal: prevent hero cards/nameplate from colliding with the action strip and presets row.

Validation:
- Visual check on a live dealt landscape hand (`932x430`) confirms hero hand now sits above controls with cleaner spacing.

Update (landscape action rail redesign + hero cards):
- Reworked landscape action UI in `/Users/abishek/Documents/poker-buyins/online-table.html` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - action buttons are now a vertical left-side rail (`Fold`, `Call`, `Raise`, `All-in`)
  - raise options panel is hidden by default and appears only when `Raise` is clicked
  - raise panel is placed in the left control zone above actions (avoids covering hero cards)
- Improved main player hand presentation in landscape:
  - increased hero card size and adjusted overlap/tilt so both cards remain clearly visible
  - kept hero area centered and readable while actions run on the left
- Bumped script cache buster from `?v=34` to `?v=35`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Live landscape hand checks at `932x430`:
  - vertical action rail renders and functions
  - raise panel only appears after pressing raise
  - hero two-card visibility restored and visually aligned

Update (table action announcements + sound cues):
- Added a shared action announcement banner to `/Users/abishek/Documents/poker-buyins/online-table.html` so live table actions surface as transient labels on the felt.
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - added shared action copy formatting for `check`, `call`, `bet`, `raise`, `fold`, and `all_in`
  - action sounds now play from new `action_taken` events instead of only on the local button press
  - added distinct `call` and `raise` tones
  - hand log action lines now use the same formatted copy as the live announcement
  - reset announcement queue/timers when entering or leaving a table view
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=39` to `?v=40`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/client.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/app.js` (pass)
- Ran the Playwright smoke client against `http://127.0.0.1:8000/online-table.html`
- Live browser validation on local table `491ce15f-ef11-435b-84cf-5b292ae82611` confirmed:
  - hero action announces as `Abishek calls $2`
  - later hero action announces as `Abishek bets $4`
  - bot actions announce as `Bot Dash folds` and `Bot Cruz checks`

Update (raise preset math fix):
- Fixed preset sizing in `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Root cause: the quick buttons (`⅓`, `½`, `¾`, `Pot`) were using `pot * fraction` even in raise spots, so the result often collapsed back to the same minimum raise and looked broken.
- Added `getPresetBetAmount(...)` so presets now use:
  - normal pot-fraction sizing for fresh bets
  - call-adjusted target sizing for raises when already facing a bet
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=40` to `?v=41`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Live browser validation on local table `65ccb435-b24e-4cfa-a3bb-94f980a5d06a`:
  - preflop facing a raise, `Pot` preset changed amount from `4` to `7`
  - `¾` preset changed amount to `6`
  - `½` preset changed amount to `5`
  - submitting `Raise` after `½` produced `Abishek raises by $5`

Update (raise preset wording clarification):
- Clarified preset wording in `/Users/abishek/Documents/poker-buyins/online/table_app.js` without changing table layout:
  - preset buttons now switch to `⅓+`, `½+`, `¾+`, `Pot+` in raise spots
  - preset buttons keep normal `⅓`, `½`, `¾`, `Pot` labels in pure bet spots
  - each preset now gets a precise accessible label/title like `pot raise to $7 after calling $2`
  - tapping a preset shows a toast with the exact result, for example `Pot raise to $7`
- Updated amount helper text to say `Raise to` instead of a generic dollar label when applicable.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=41` to `?v=42`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Live browser validation on local table `def15a9a-aedc-4864-bd73-ea0643d7cfbe`:
  - preflop facing a raise with pot at `$3`, the preset row showed:
    - `⅓+` -> `one third pot raise to $4 after calling $2`
    - `½+` -> `half pot raise to $5 after calling $2`
    - `¾+` -> `three quarter pot raise to $6 after calling $2`
    - `Pot+` -> `pot raise to $7 after calling $2`
  - tapping `Pot+` updated the amount to `7` and showed toast `Pot raise to $7`

Update (portrait hero seat stays anchored after deal):
- Adjusted portrait hero-seat layout in `/Users/abishek/Documents/poker-buyins/online-table.html` so the main player remains anchored at the same bottom-center rail position before and after cards are dealt.
- Changed the portrait `.my-hand-area` from a side-by-side tray into a vertically stacked anchored seat:
  - cards now sit above the hero badge/nameplate
  - the hero badge no longer shifts to a separate lower tray when hole cards appear
  - the old turn-state sideways shove is overridden so the whole hero block stays centered at the rail
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=42` to `?v=43`.

Validation:
- Live browser validation on local table `6bfbe3b7-5f84-4967-b0a1-ded1185e5acc`:
  - before deal: hero badge stayed seated at the bottom rail
  - after deal: hero cards stacked above the badge while the badge stayed in the same anchored location

Update (portrait hero card fan + badge overlay):
- Tweaked the portrait hero stack in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - widened the hero card fan by increasing the spread/rotation of both cards
  - increased the hero card container width slightly
  - moved the hero badge in front of the cards by flipping z-index layering and increasing overlap
- This keeps the anchored bottom-center hero seat from the previous pass but makes the stack feel more intentional and readable.

Validation:
- Live browser validation on local table `98b8fc4c-3c1a-4f78-bb8a-020d2363ff35` confirmed:
  - cards fan outward more visibly
  - hero badge sits on top of the lower portion of the cards

Update (portrait hero cards nudged upward):
- Nudged the portrait hero card stack upward in `/Users/abishek/Documents/poker-buyins/online-table.html` by adding a small upward translate on `.my-hand-cards`.
- Goal: keep the badge anchored while making more of the fan visible above it.

Validation:
- Live browser validation on local table `78576507-0c2f-43d5-88c3-6bb59f1405c4` confirmed the hero cards sit slightly higher above the badge than before.

Update (showdown opponent cards readability bump):
- Increased opponent reveal card size during showdown in `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - portrait/compact floating showdown cards increased from `31x44` to `35x50`
  - landscape floating showdown cards increased from `25x35` to `29x41`
  - added `.seat-cards-row.showdown` sizing for non-compact seat-row reveals
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` so non-compact opponent seat rows receive a `showdown` class when their cards are revealed at showdown.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster from `?v=43` to `?v=44`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Browser verification with a temporary showdown sample on the live table confirmed portrait showdown reveal cards render at `35px x 50px` with `12px` rank text and are more legible.

- 2026-03-08: Hid the center dealer deck visually by setting base `.dealer-deck` opacity to 0, keeping the element in place so deal animations still have a launch origin.

- 2026-03-08: Made the hand-deal animation more dramatic with slower stagger/timing, a curved dealer-flick flight path, and a softer card settle on arrival.

- 2026-03-08: Replaced the flat black table-view shell with a richer casino-room backdrop using warm spotlight glows, mahogany side shading, and subtle room texture in both portrait and landscape.

- 2026-03-08: Added a bottom-center ambient glow behind the hero seat so the area under the main player no longer drops to flat black.

- 2026-03-08: Reworked the table-view shell from warm mahogany glows to a subtler neon lounge palette: deep blue-black base, soft cyan/emerald light spill, and restrained violet side bloom.

- 2026-03-08: Moved the landscape Deal button upward with a clamped bottom offset so it clears the main player badge on short screens without drifting too close to the board.

Update (QA end-to-end review pass):
- Ran the web-game smoke client against `http://127.0.0.1:8000/online-table.html`.
- Ran a live two-tab Playwright check locally:
  - host created table `2d85c762-d22c-403e-876f-f3bf4a5469d4`
  - second tab joined as `GuestQA`
  - dealt a heads-up hand and exercised cross-tab action flow
  - checked portrait/landscape visuals, console warnings, and network traffic
- Confirmed a likely heads-up postflop first-to-act bug in `supabase/online_poker_schema.sql`.
- Confirmed every open client currently calls `online-runtime-tick`, which is a scaling/race risk.
- Noted a reconnect/loading UX flash (`Table` / `0 seated`) on same-device re-entry before first table state resolves.
- Noted repeated browser warnings from non-standard `slider-vertical` appearance styling.

- 2026-03-08: Slowed the overall online-table rhythm and upgraded bot behavior:
  - increased hole-card deal stagger/flight timings in `/Users/abishek/Documents/poker-buyins/online/table_app.js`
  - made bot think-time context-aware by street / facing-bet / pot size in `/Users/abishek/Documents/poker-buyins/online/bot_engine.js`
  - improved postflop bot judgment with draw detection, pair-quality bonuses, and semi-bluff handling in `/Users/abishek/Documents/poker-buyins/online/bot_engine.js`

- 2026-03-08: Added a staged board reveal for new streets in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - newly dealt flop/turn/river cards now land face-down on an FX layer and flip after settling
  - flop uses a three-card laydown followed by a staggered flip to feel more casino-like
  - real board cards stay hidden only while the reveal FX is active, then restore normally
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=67`

- 2026-03-08: Tightened the board reveal landing in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - board FX cards now arrive square to the board slots instead of landing slightly misaligned first
  - keeps the dramatic laydown + flip while removing the visible “straighten” effect at the end
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=68`

- 2026-03-08: Fixed repeated showdown card blinking for opponents in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - showdown reveal animation now runs once per revealed opponent seat per hand instead of restarting on every state refresh
  - added per-hand showdown reveal tracking in client state
  - moved the CSS animation trigger from generic `.showdown` to `.showdown.showdown-fresh`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=69`

- 2026-03-08: Tightened hero spectator CTA behavior in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - `Buy In` now appears for a busted hero even while another hand is still active, as long as the hero is not currently all-in in that hand
  - `Top Up` now keys off `seat.chip_stack` (actual bankroll) instead of temporary live-hand `stack_end`
  - `Top Up` remains between-hands only, so it does not appear just because chips are committed during a live hand
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=70`

- 2026-03-08: Smoothed the board-card handoff in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - underlying board cards now fade in underneath the reveal FX before the overlay is removed
  - board-flight cards now decelerate into a light hover/settle instead of ending with a pop-snap handoff
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=71`

- 2026-03-08: Tightened the board-card takeover timing in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - actual board cards now appear earlier during the flip
  - flying reveal cards fade out during the flip instead of lingering offset after the flip
  - intended effect is a hover-into-slot / place-in-board feel rather than an offset linger followed by a snap
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=72`

- 2026-03-08: Added temporary live table chat in `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - chat uses a dedicated Supabase Realtime broadcast channel per table (`table-chat:{tableId}`), so connected players can chat live without any schema migration
  - messages are intentionally ephemeral and are not persisted or replayed after reconnect, matching the “temp chat” requirement
  - added lower-corner chat button, unread badge, compact slide-up panel, enter-to-send, and local dedupe
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=74`
  - verified cross-tab delivery on the same live table after moving chat off the main table-state channel and onto its own explicit broadcast transport
- 2026-03-08: Extended chat for late joiners:
  - added `online_table_chat_messages` plus `online_get_table_chat_messages` and `online_post_table_chat_message` in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
  - `online_get_table_state_viewer` now includes `chat_messages`, so a player joining mid-session can hydrate recent table chat immediately after seating
  - kept live broadcast for instant delivery, with DB-backed recent history as the source of truth for catch-up
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=75`
- 2026-03-08: Fixed chat send regression caused by stale browser module cache:
  - versioned the `online/client.js` import from `/Users/abishek/Documents/poker-buyins/online/table_app.js`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache buster to `?v=76`

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/bot_engine.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Ran `$WEB_GAME_CLIENT` smoke load against `http://127.0.0.1:8000/online-table.html`
- Live local Playwright hand on table `4a41636e-a06b-4eaa-b057-578331c8da21`:
  - confirmed `sawBoardFx: true` during the flop reveal
  - measured roughly `3045ms` from hero preflop call to flop landing
  - visually confirmed slower pacing and board reveal without breaking the hand flow

- 2026-03-08: Added seated-only Daily voice chat scaffolding:
  - `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
    - added `online_table_voice_state`
    - added `online_claim_voice_floor`, `online_refresh_voice_floor`, and `online_release_voice_floor`
    - extended `online_get_table_state_viewer` to return `voice_state`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/online-voice-session/index.ts`
    - new Edge Function that validates seated human access
    - checks current-month Daily usage before issuing voice access
    - lazily creates a private Daily room per table and returns a meeting token
  - `/Users/abishek/Documents/poker-buyins/online/client.js`
    - added wrappers for voice floor RPCs and the new voice session Edge Function
  - `/Users/abishek/Documents/poker-buyins/online/table_app.js`
    - added mic button state handling
    - added push-to-talk behavior with server-backed single-speaker lock + heartbeat expiry
    - added Daily call-object join/leave handling
    - added voice-speaker highlight on seat badges / hero badge
  - `/Users/abishek/Documents/poker-buyins/online-table.html`
    - added compact mic button beside chat
    - added Daily browser SDK script
    - bumped cache buster to `?v=78`

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/client.js` (pass)
- Browser sanity pass on local table `3ea64aa1-788d-46b7-aa6e-b24725f3feff`:
  - mic button renders beside chat in live table UI
  - click path currently shows a friendly deployment message because `online-voice-session` is not deployed yet

Remaining external rollout steps:
1) Apply `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` to the Supabase project.
2) Deploy `/Users/abishek/Documents/poker-buyins/supabase/functions/online-voice-session/index.ts`.
3) Once deployed, re-test voice join + push-to-talk on two seated devices/tabs.

- 2026-03-08: Rolled the voice backend live to Supabase:
  - linked CLI to project `xngwmtwrruvbrlxhekxp`
  - created and pushed migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260309034846_add_daily_voice_chat.sql`
  - deployed Edge Function `online-voice-session`
  - browser re-check confirmed the mic now reaches the deployed backend and transitions to `Voice connected`

Remaining validation:
1) Test two seated devices/tabs in the same table to confirm push-to-talk floor locking and audio handoff.
2) Verify real browser mic permission behavior on mobile Safari/Chrome.

- 2026-03-09: Converted hand log into a floating top-pane window in /Users/abishek/Documents/poker-buyins/online-table.html and /Users/abishek/Documents/poker-buyins/online/table_app.js:
  - log toggle now opens a narrow floating pane from the top controls instead of the bottom drawer
  - added explicit burn entries before flop/turn/river in the rendered hand log using existing street_dealt payloads
  - street log lines now show the newly revealed cards for each street rather than repeating the full board
  - bumped /Users/abishek/Documents/poker-buyins/online-table.html cache buster to ?v=104

- 2026-03-09: Replaced separate seat timer circles with avatar-ring countdown styling in /Users/abishek/Documents/poker-buyins/online-table.html and /Users/abishek/Documents/poker-buyins/online/table_app.js:
  - removed SVG timer rings from seat render path
  - active turn countdown now animates directly on seat and hero avatar rings using the existing gold/orange ring
  - danger tick sound now only plays for the acting player
  - bumped /Users/abishek/Documents/poker-buyins/online-table.html cache buster to ?v=111

Update (victory reveal polish pass):
- Removed table-surface win reason banner and replaced it with a small blurred victory popup outside the felt in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Added delayed popup scheduling in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so result messaging waits for any deferred street reveal + board flip timing before appearing.
- Popup now shows winner/split summary plus hand type (or everyone folded) and hangs briefly before auto-hiding.


Update (action latency + board reveal timing pass):
- Reduced intentional client-side action-banner delay in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so actions clear faster.
- After a player action, the client now nudges `online-runtime-tick` immediately when backend follow-up work is pending (bot turn / all-in progress / showdown), then reloads state again for a snappier hand flow.
- Fixed street-reveal sequencing so board cards stay hidden during the deferred action-beat and only appear through the deal/flip animation, instead of showing face-up first and then reanimating.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=117`.

Update (raise grace + side-pot UI):
- Added a backend-backed turn grace extension in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` and `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260310013000_add_turn_grace_timer.sql`.
- Grace only applies when the active player is using raise controls late in the clock, grants small chunks, and caps at 6 extra seconds per turn.
- Reset the grace budget whenever action passes, streets change, or a hand settles so it cannot be banked or abused.
- Reused the existing showdown side-pot algorithm on the client and added compact `Main / Side / Side 2...` labels in the pot area during all-in hands.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=119`.

Update (showdown pacing + seat contribution labels):
- Delayed backend auto-deal eligibility by an extra 2 seconds in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` and migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260310021500_delay_auto_deal_for_showdown_presentation.sql` so the board reveal / payout / victory presentation can complete before the next hand starts.
- Added a settled-hand presentation guard in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so the manual `Deal` button stays hidden until street-reveal FX, payout FX, victory popup, and win overlays are all done.
- Upgraded persistent felt contribution chips to action-aware labels (`Bet $X`, `Call $X`, `Raise $X`, `All-in $X`) instead of amount-only pills.

Update (persistent checks + pot-anchored winner message):
- Persistent seat labels in `/Users/abishek/Documents/poker-buyins/online/table_app.js` now keep `Check` visible for the current street instead of only showing a transient popup.
- Winner popup no longer auto-hides after a short timer; it stays visible until the hand actually rolls forward, and manual `Deal` now waits until the configured next-hand timeout has elapsed.
- Repositioned the blurred winner popup in `/Users/abishek/Documents/poker-buyins/online-table.html` to sit above the pot display instead of near the top rail.

Update (seat-anchored action labels):
- Removed transient seat/hero action popups from the render path in `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Persistent action labels now attach directly to the player badge area instead of floating toward the table center:
  - left seats -> right chin
  - right seats -> left chin
  - top seat -> bottom chin
  - hero -> top of the hero label
- Adjusted `/Users/abishek/Documents/poker-buyins/online-table.html` styling for the new anchored chip look and bumped the bundle to `v=124`.

Update (showdown winning-combo highlight pass):
- Extended `/Users/abishek/Documents/poker-buyins/online/showdown.js` and `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/showdown.ts` so `describeSevenCardHand(...)` now returns the exact winning five-card combo as `winningCards`, with a preference for including the player's hole cards when multiple equivalent combinations tie.
- Updated `/Users/abishek/Documents/poker-buyins/online/table_app.js` to highlight the current showdown winner's contributing hole cards, lift the contributing board cards in place, and dim the unused community cards.
- Updated `/Users/abishek/Documents/poker-buyins/online-table.html` highlight styling and bumped the online table bundle to `v=130`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/showdown.js` (pass)
- `node /Users/abishek/Documents/poker-buyins/online/showdown.test.js` (pass)

Update (reactive hero pre-actions + pacing pass):
- Reworked the waiting-state hero rail in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so it now reacts to live action instead of showing static pre-actions:
  - top slot becomes `Check/Fold` when unopened and auto-switches to `Fold` once a bet appears
  - middle slot becomes `Check` when unopened and dynamically turns into `Call $X` once there is money to call
  - bottom slot remains `Call Any`
- Added a separate `call_current` pre-action mode so the dynamic middle button can auto-execute correctly on turn and river without behaving like `Call Any`.
- Added a small round-transition breathing-room hold before street changes / showdown presentation so the table doesn’t rush immediately into the next phase after the final action of a betting round.
- Lowered the hero action chip in `/Users/abishek/Documents/poker-buyins/online-table.html` so it sits closer to the hero cards.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=131`.

Update (speed polish):
- Tightened the table feel in `/Users/abishek/Documents/poker-buyins/online/table_app.js` by reducing deal/reveal timing constants, shortening the between-street hold, and increasing the fallback poll cadence so stale clients recover faster.
- Added optimistic hero action feedback so the hero’s action chip updates immediately on submit while the server-confirmed state catches up.
- Triggered a best-effort runtime nudge immediately after manual hero actions so bot turns / all-in progression start sooner instead of waiting for the next backend cadence.
- Added instant `Dealing...` feedback on the manual Deal button.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=132`.

Update (showdown climax timing):
- Delayed winner resolution presentation in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so all-in runouts now follow a clean sequence: board runout finishes, short breath, then winner highlight / summary / payout FX.
- Added a shared showdown result reveal gate so winning-card highlights on the board and hole cards do not appear while the final community cards are still animating in.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=133`.

Update (hero-relative compact seat mapping):
- Reworked compact/mobile seat assignment in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so the hero still stays anchored in the hand area, but the remaining table seats are now ordered clockwise from the hero instead of filling visual slots by raw seat number.
- Kept the existing hand-tuned portrait and landscape seat coordinates untouched; only the mapping from real seats to those slots changed.
- Added a geometric clockwise slot-order helper so the larger 7–10 player compact layouts preserve a sensible sweep from hero-right, across the top, to hero-left.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=134`.

Update (pre-action safety + bot preflop realism):
- Reworked hero pre-actions in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so the queued `Call $X` pre-action now remembers the agreed amount and automatically clears itself if opponents re-raise to a different number before the hero acts.
- Kept `Call Any` as the explicit opt-in to keep following future raises, while leaving `Check/Fold` reactive to unopened vs bet-facing states.
- Tuned `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.ts` to use more human preflop raise sizing and stricter jam conditions, so bots only shove preflop with short-stack or genuinely premium spots instead of routinely escalating to all-in.
- Increased `ROUND_TRANSITION_BREATH_MS` slightly in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so street changes read more clearly without slowing button responsiveness.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=135`.

Update (simplify waiting pre-actions):
- Removed the redundant standalone `Check` choice from the hero waiting rail in `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- The waiting rail now shows `Check/Fold` plus `Call Any`, and only reveals the middle `Call $X` button once there is an actual bet to call.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=136`.

Update (server bot commitment + sizing model):
- Reworked `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.ts` so bot preflop decisions now use structured poker situations (`unopened`, `limped`, `vs_open`, `vs_3bet`, `vs_4bet_plus`) instead of a single aggression threshold.
- Added effective-stack / commitment guardrails:
  - position-aware opens and iso-raises
  - more realistic flatting vs opens and 3-bets
  - 4-bet / jam only when stack depth and prior action make it logical
  - smaller, human-style value sizing intended to keep dominated hands in
- Added SPR-aware postflop risk caps so medium-strength made hands stop taking giant punt lines while strong value can still stack off naturally at low SPR.
- Updated `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts` to pass richer live context into the bot engine (`streetAggressionCount`, `preflopLimperCount`, `effectiveStackBb`).
- Added focused regression coverage in `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.test.ts` for deep-stack opens, 3-bet spots, short-stack jams, and deep postflop value behavior.

Update (dynamic bot personality + hidden personality UI):
- Added hidden in-hand personality evolution in `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.ts` so bots no longer stay fixed as TAG/LAG/Rock/Station for the whole session.
- The effective style now shifts from the stored base archetype based on stack growth, short-stack pressure, effective depth, and table-average stack context, while still staying inside sane poker guardrails.
- Updated `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts` to pass starting-stack and table-average context into the server bot engine.
- Removed player-facing personality leaks from `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - add-bot toast no longer announces the archetype
  - seat badge now shows generic `AI` instead of `AI · Tight-Agg` style labels
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=137`.

- 2026-03-10: Strengthened active-turn highlight styling and lowered hero action chip for clearer turn ownership on mobile.
- 2026-03-10: Cleared seat payout tags when chip-push finishes and tightened iPhone portrait winner/board stack spacing for less overlap near lower seats.

Update (2026-03-10: board reveal replay regression):
- Reworked board reveal scheduling in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so newly detected board cards are appended onto a future timeline slot instead of inheriting stale street timing.
- Fixed `maybeLaunchStreetRevealFx(...)` delay calculation to be elapsed-aware (`landAt/flipAt - elapsed`) and cleanup to use remaining timeline duration, preventing reveal/hide/re-reveal artifacts.
- Kept action-lock gating during reveal windows intact.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=147`.

Update (2026-03-10: board reveal underlay sync):
- Added animation-phase timers in `/Users/abishek/Documents/poker-buyins/online/table_app.js` to mark each board card as settled right when its flip completes, independent of polling cadence.
- `getStreetRevealMeta(...)` now reads per-card `revealedIndices` so the static board underlay appears exactly when each card lands/flips, preventing the temporary hide/re-show flicker.
- Added cleanup for these phase timers in `clearStreetRevealFx(...)`.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=148`.

Update (2026-03-11: showdown card overlap from stale action labels):
- Fixed persistent seat action chips in `/Users/abishek/Documents/poker-buyins/online/table_app.js` so contribution labels (`Check/Call/Bet/Raise`) no longer render during `showdown` or `settled` states.
- This prevents last-action labels from covering revealed showdown cards on side seats.
- Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` bundle to `v=162`.

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- Ran web-game Playwright client against local server (`http://127.0.0.1:8000/online-table.html`) and reviewed latest capture:
  - `/Users/abishek/Documents/poker-buyins/output/web-game/shot-0.png`

Update (2026-03-11: host-initiated group voice call flow):
- Reworked table voice UX in `/Users/abishek/Documents/poker-buyins/online/table_app.js` from push-to-talk to host-controlled group call behavior:
  - Host now gets `Start table call` / `End table call`.
  - Other seated human players get incoming-ring state and can join any time.
  - Joined players stay in the same Daily call while remaining players continue seeing ringing/join prompts.
  - Added incoming call panel with `Answer` / `Later`.
  - Added periodic ring tone cues for incoming call (respects sound preference).
- Updated `/Users/abishek/Documents/poker-buyins/online-table.html`:
  - Phone-style call icon/button states.
  - Floating incoming-call panel UI.
  - Cache-buster bumped to `v=163`.
- Updated `/Users/abishek/Documents/poker-buyins/online/client.js` with new RPC wrappers:
  - `startVoiceCall(...)`
  - `endVoiceCall(...)`
- Extended DB/API in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`:
  - `online_table_voice_state` now carries call state (`call_status`, caller, started_at).
  - `online_get_table_state_viewer(...)` now returns call-state fields.
  - Added host-only RPCs:
    - `online_start_voice_call(...)`
    - `online_end_voice_call(...)`
- Added migration:
  - `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260311142000_add_group_call_mode.sql`

Validation:
- `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js` (pass)
- `node --check /Users/abishek/Documents/poker-buyins/online/client.js` (pass)
- Playwright smoke against local table page completed (no new runtime crash): `/Users/abishek/Documents/poker-buyins/output/web-game/shot-0.png`

- Simplified table voice to shared-room semantics: host enables/disables table voice, seated players join/leave directly, no ringing/incoming-answer flow.
- Updated client voice UI state machine in `online/table_app.js` and added migration `20260311191500_simplify_table_voice_to_shared_room.sql` so host-start marks voice active immediately.
- Fixed host-start race in shared voice flow: host can now join immediately after enabling table voice without waiting for a table-state refresh.

- Added per-hand manual card reveal for human players after settlement via `online_set_hand_cards_visibility(...)`, with `manually_shown` stored on `online_hand_players`.
- Hero action rail now shows `Show Cards` / `Hide Cards` after a settled hand and seat rendering honors voluntary reveals even for folded players once the hand is over.
- Fixed post-hand settled-state cleanup in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - winner popup now auto-dismisses at the end of the showdown hang-time instead of blocking the table indefinitely
  - once the hang-time completes, the board, pot, showdown cards, and folded/all-in visual state clear back to an idle table shell while final stacks/history remain intact
  - this restores manual `Deal` and empty-seat `Add Bot` usability when auto-deal is off or when a solo host is waiting for more players
- Hardened the hero action strip idle state in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - all betting buttons are explicitly hidden when the hero is not in an actionable betting state
  - added `isHeroTurnActionable(...)` so stale clicks on Fold/Call/Raise/All-in cannot fire after the hand is over or during non-action windows

- Fixed zero-value river action regressions in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` and `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - added `online_normalize_money(...)` so betting logic, showdown settlements, everyone-folded payouts, and fresh hand setup clamp dust amounts back to real cent precision
  - `online_betting_round_complete(...)` now compares normalized street contributions, preventing microscopic leftovers from reopening action on the river
  - hero/live action UI now normalizes `toCall`, contribution labels, and action announcements so fake `Call $0.00` / `All-in $0.00` states do not render
  - added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260311214500_fix_zero_value_river_regressions.sql`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache version to `v=169`

- Fixed settled-hand sequencing regression where the auto-deal countdown started at the same time as the winner banner:
  - split `/Users/abishek/Documents/poker-buyins/online/table_app.js` hand-end timing into:
    1. winner presentation window
    2. auto-deal countdown window
  - winner popup now hides when the presentation window ends instead of staying visible through the countdown
  - auto-deal countdown now waits until showdown presentation is fully inactive before rendering
  - aligned backend due-table timing in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` by adding the same winner-presentation lead before auto-deal eligibility
  - added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260311221500_delay_auto_deal_countdown_until_after_winner_hang.sql`
  - bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache version to `v=170`
  - validation:
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js`
    - `supabase db push`
    - Playwright smoke against local server with reviewed capture:
      - `/Users/abishek/Documents/poker-buyins/output/web-game-timing-fix/shot-0.png`

- Fixed hero fold-label regression in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - `buildOptimisticSeatAction(...)` now maps `fold` to `Fold` instead of falling through, which was allowing the hero seat label to incorrectly keep showing `Check`
  - validation:
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js`

- Fixed post-hand hero control overlap in `/Users/abishek/Documents/poker-buyins/online/table_app.js`:
  - added `clearDisplayedActionAnnouncements()` so settled-hand `Show Cards` mode clears stale live-action announcements without resetting hand-announcement history
  - entering hero `Show Cards` mode now also clears stale optimistic hero action state, preventing `Show Cards` from appearing alongside leftover `Check` UI
  - validation:
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js`
- Fixed winner-banner hold regression in `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
  - Root cause: winner presentation timing depended too heavily on server `ended_at`, so if the client learned about settlement late, the visible banner time could already be partially consumed.
  - Fix: track a local `victoryPopupVisibleUntilMs` and keep auto-deal countdown / Deal button gated until the banner has actually been visible for the full local hang window.
  - Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache key to `v=171`.
- Fixed river showdown hand-log ordering regression in `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`.
  - Root cause: `online_submit_action(...)` appended `showdown_ready` / street transition events before appending the actor’s final `action_taken`, so logs could show `Showdown` and then a trailing river `check` or `call`.
  - Fix: write the accepted action row and `action_taken` event immediately after applying the action, before any `showdown_ready` or next-street transition events.
  - Added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260311230000_fix_river_showdown_event_order.sql` and applied it with `supabase db push`.
  - Historical hands will still show the old wrong order; this corrects new hands going forward.
- Fixed `Show Cards` post-hand control instability in `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
  - Root cause: the toggle was gated by the global `state.loading` flag, so background table polling could silently swallow taps; polling could also briefly repaint the button back to the pre-click state.
  - Fix: added a dedicated `heroShowCardsPending` state plus a tiny optimistic `heroShowCardsOverride` for the settled hand, so the button remains stable and clickable while the reveal request is in flight.
  - Bumped `/Users/abishek/Documents/poker-buyins/online-table.html` cache key to `v=172`.
- Reviewed an uncommitted frontend performance refactor and kept the good parts while hardening the risky edges.
  - Verified the refactor added:
    - a queued render gate inside `/Users/abishek/Documents/poker-buyins/online/table_app.js`
    - a new worker at `/Users/abishek/Documents/poker-buyins/online/table_equity_worker.js`
    - geometry extraction to `/Users/abishek/Documents/poker-buyins/online/table_fx_geometry.js`
  - Fixed the biggest regression in the worker bootstrap:
    - replaced `document.currentScript`-based worker URL construction with `new URL(..., import.meta.url)` in `/Users/abishek/Documents/poker-buyins/online/table_app.js`
    - aligned cache busting for `/Users/abishek/Documents/poker-buyins/online-table.html`, `/Users/abishek/Documents/poker-buyins/online/table_app.js`, and `/Users/abishek/Documents/poker-buyins/online/table_equity_worker.js` to `v=174`
  - Hardened async equity updates:
    - worker responses now echo `reqKey` and `reqTableId`
    - UI only accepts results for the current table and current equity cache key
    - stale equity cache is cleared before requesting a fresh calculation so old percentages do not linger across streets
    - worker completion no longer repaints seats immediately during active presentation phases; it defers by setting the queued render flag
  - Tightened queued-render flushing:
    - `checkQueuedRender()` now refuses to flush while a load is still in progress or before table state exists
    - `clearPendingSettlementFx()` now also attempts a queued render flush so the queue cannot get stranded behind a canceled settlement timer
  - Validation:
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_app.js`
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_equity_worker.js`
    - `node --check /Users/abishek/Documents/poker-buyins/online/table_fx_geometry.js`
- Follow-up live QA on the refactor caught two real browser/runtime regressions and fixed them before commit.
  - Problem 1: the refactored deal-animation loop in `/Users/abishek/Documents/poker-buyins/online/table_app.js` had an extra closing brace, which caused a browser parse failure (`Illegal return statement`) and prevented the lobby submit handler from attaching. The page rendered, but `Create Table` fell back to raw form submission.
  - Fix 1: removed the stray brace and revalidated with `esbuild` bundling plus browser playback.
  - Problem 2: `/Users/abishek/Documents/poker-buyins/online/table_fx_geometry.js` still depended on `isLandscape()` from the old monolithic file scope, so live table rendering threw `ReferenceError: isLandscape is not defined` on first state load.
  - Fix 2: added a local `isLandscape()` helper inside the geometry file and bumped asset versions to `v=175` in `/Users/abishek/Documents/poker-buyins/online-table.html`, `/Users/abishek/Documents/poker-buyins/online/table_app.js`, and `/Users/abishek/Documents/poker-buyins/online/table_equity_worker.js`.
  - Live validation after fixes:
    - created a real online table from the lobby in browser
    - added a bot successfully from an empty seat
    - dealt live hands successfully
    - confirmed hand log, showdown banner, and `Show Cards` still function on the fixed bundle
- Fixed a runtime dispatch regression that could freeze live hands after the new secret-gated edge hardening.
  - Root cause: `online_dispatch_edge_runtime()` was updated to require the DB-side helpers `online_private.get_supabase_anon_key()` and `online_private.get_runtime_dispatch_secret()`, but those helpers only looked in `vault.decrypted_secrets` or unsupported `app.settings.*` custom GUCs. The live project had the values in Edge Function secrets, not in Postgres, so the cron dispatch path failed with `supabase_anon_key_not_configured` and hands stopped advancing.
  - Fix: added a private singleton table `online_private.runtime_dispatch_config` plus a service-role-only setter `online_set_runtime_dispatch_config(...)`, and updated the getter helpers to read that row first before falling back to vault/current_setting.
  - Added migration `/Users/abishek/Documents/poker-buyins/supabase/migrations/20260312175000_store_runtime_dispatch_config_in_db.sql`.
  - Seeded the live project with the current anon key and runtime dispatch secret, then manually invoked `online_dispatch_edge_runtime()` to recover the stuck `Diamond Pot` hand, which advanced from frozen preflop to live flop.
