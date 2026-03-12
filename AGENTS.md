# Poker Buy-ins / Poker Nights — Agent Handoff Context

Updated: 2026-03-12

## 1) Product Intent
- This repo contains two products sharing one codebase:
  - a stable **in-person poker tracker** for home games
  - a separate **online Texas Hold'em experience** with live multiplayer, bots, hand history, and table controls
- The visual direction is premium dark poker: gold accents, deep green felt, mahogany rails, avatar-centric seats, mobile-first layout.

## 2) Critical Non-Negotiables
- **Do not break the in-person flow.**
  - Existing buy-in tracking, group sessions, casual sessions, settlement, stats, and history must continue to work.
- The online mode must stay logically separate from the in-person tracker even though both launch from the same landing page.
- The hidden system group `__online_lobby__` must never leak into in-person UI.
  - Filtering is done in `refreshGroups()` in `/Users/abishek/Documents/poker-buyins/app.js`.
- When uncertain, treat `/Users/abishek/Documents/poker-buyins/online/table_app.js` and `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql` as the current source of truth for online behavior.

## 3) Main User Flows

### In-person / Home Game
- Entry is the landing page in `/Users/abishek/Documents/poker-buyins/index.html`.
- Main orchestration lives in `/Users/abishek/Documents/poker-buyins/app.js`.
- The `Home Game` accordion hosts the traditional in-person flow:
  - game name
  - buy-in
  - host name
  - group selector
  - `Host game`
- This flow must remain untouched unless the user explicitly asks for in-person changes.

### Online Poker
- Entry points:
  - create from landing page `Online` accordion
  - join via shared URL `online-table.html?table=UUID`
  - reopen from Sessions > Online Games
- Landing page online create flow in `/Users/abishek/Documents/poker-buyins/app.js`:
  - calls `online_ensure_lobby_player`
  - calls `online_create_table`
  - calls `online_join_table`
  - stores seat token in localStorage
  - redirects to `/Users/abishek/Documents/poker-buyins/online-table.html?table=UUID`
- Join-link flow happens inside `/Users/abishek/Documents/poker-buyins/online-table.html` + `/Users/abishek/Documents/poker-buyins/online/table_app.js`.

## 4) Current Architecture Boundaries

### In-person app
- `/Users/abishek/Documents/poker-buyins/index.html`
- `/Users/abishek/Documents/poker-buyins/app.js`
- `/Users/abishek/Documents/poker-buyins/styles.css`

### Online frontend
- `/Users/abishek/Documents/poker-buyins/online-table.html`
- `/Users/abishek/Documents/poker-buyins/online/table_app.js`
- `/Users/abishek/Documents/poker-buyins/online/client.js`
- `/Users/abishek/Documents/poker-buyins/online/showdown.js`
- `/Users/abishek/Documents/poker-buyins/online/bot_engine.js`

### Online backend
- `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
- `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts`
- `/Users/abishek/Documents/poker-buyins/supabase/functions/online-voice-session/index.ts`
- shared edge logic:
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/showdown.ts`
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.ts`

### Runtime ownership
- **Production gameplay authority is server-side.**
- The Edge function `online-runtime-tick` is the canonical runtime for:
  - bot decisions
  - turn timeout actions
  - auto-deal
  - all-in board progression
  - showdown settlement triggers
- `/Users/abishek/Documents/poker-buyins/online/runtime_worker.js` is legacy/dev tooling only. Do not treat it as the production runtime.
- `/Users/abishek/Documents/poker-buyins/online/bot_engine.js` is still useful as a local/reference strategy file, but current production bot play is driven from the Edge runtime shared bot engine.

## 5) Identity, Seating, and Device Ownership
- `online_ensure_lobby_player(name)` creates or reuses a player inside the hidden `__online_lobby__` group.
- Every live mutation requires a seat token.
- Seat tokens are stored locally as:
  - `online_seat_token:{tableId}:{groupPlayerId}`
- Important seat ownership helpers:
  - `online_join_table`
  - `online_leave_table`
  - `online_claim_table_seat`
- Viewer-safe state comes from:
  - `online_get_table_state_viewer(...)`
- That viewer RPC masks other players' hole cards until they are legally revealable.

## 6) Current Online Feature Set

### Table lifecycle
- Host creates a table from the landing page online accordion.
- Players join by shared link and name.
- Host transfers automatically when the host leaves.
- Table closes when everyone leaves.
- Empty seats can be filled by humans or bots.

### Hand lifecycle
- `Deal` starts the hand manually when needed.
- If auto-deal is enabled:
  - hand settles
  - winner banner appears
  - banner hangs locally
  - countdown runs on the Deal button
  - next hand starts
- If auto-deal is disabled:
  - hand clears cleanly to idle state
  - `Deal` becomes available again

### Betting / turn system
- Supported actions:
  - fold
  - check
  - call
  - bet
  - raise
  - all-in
- Hero controls support:
  - raise slider
  - typed amount
  - pot fraction presets
  - compact portrait/landscape action rail
- Pre-actions are built into the same compact rail:
  - `Check/Fold`
  - `Call` only when there is a live amount to call
  - `Call Any`
- Auto-check on timeout is configurable per seated human via preferences.
- Timeout rule is poker-correct:
  - if `toCall == 0`, timeout resolves as `check`
  - otherwise timeout resolves as `fold`

### Showdown / reveal behavior
- Normal showdown reveals only legally revealable hands.
- In all-in runout showdowns, all live all-in players' hole cards are shown.
- After settlement, a human player can manually reveal or hide their own hole cards using `Show Cards` / `Hide Cards`.
- Manual reveal is per player, per settled hand, via:
  - `online_set_hand_cards_visibility(...)`
- Current reveal/presentation sequencing matters:
  - board reveal completes first
  - showdown combo highlight happens after a pause
  - winner banner hangs
  - then auto-deal countdown or manual Deal resumes

### Chat
- Temporary but persisted table chat exists.
- Messages are stored per table in `online_table_chat_messages`.
- Late joiners can see previous chat history.
- Chat UI is a floating translucent panel with drag support.

### Voice
- Current UX is **shared table voice**, not push-to-talk and not ringing/answer flow.
- Host enables or ends table voice.
- Seated human players can join or leave the table voice room.
- Voice session creation is handled by the Edge function:
  - `/Users/abishek/Documents/poker-buyins/supabase/functions/online-voice-session/index.ts`
- Uses Daily and enforces a monthly soft cap:
  - `VOICE_LIMIT_MINUTES = 9000`
- Spectators should not be allowed to use voice.
- Some older `call` / `voice floor` naming remains in RPCs and DOM, but current product intent is shared-room table voice.

### Hand log / history
- Hand log opens from the top bar and appears as a narrow floating panel.
- It is scrollable during live hands.
- It captures rich event detail including:
  - street deals
  - burns
  - actions
  - showdown notes
  - payouts
  - side-pot outcomes in text form
- Sessions sidebar includes `Online Games`, which shows completed online table summaries and in/out/final stats.

## 7) Bot System — Current Production Model
- Production bots are executed server-side by `online-runtime-tick`.
- Bot decisions use `/Users/abishek/Documents/poker-buyins/supabase/functions/_shared/bot_engine.ts`.
- Current personalities:
  - `TAG`
  - `LAG`
  - `Rock`
  - `Station`
- Opponent profiling exists and is real, not cosmetic:
  - tags such as `nit`, `tag`, `lag`, `station`, `trapper`, `bluff-heavy`, `river-overfolder`
  - transient states such as `tilting`, `protecting_stack`, `bullying`, `sticky_after_showdown`
- Profiles are pulled via:
  - `online_get_bot_opponent_profiles(...)`
- Runtime considers:
  - board state
  - action shape on the street
  - effective stack in big blinds
  - average opponent stack depth
  - recent opponent tendencies
- Bots auto-rebuy up to 5 times, then leave the table.

## 8) Poker / Rules Integrity Notes
- Shuffle is server-side in SQL.
- Hand ranking / showdown payout logic exists in both frontend and edge/shared forms for rendering and settlement.
- Side pots are supported in settlement logic.
- Main UI intentionally keeps the center pot simpler; side-pot detail is shown in the hand log rather than as a cluttered felt overlay.
- The codebase has explicit protections against dead-chip aggression:
  - if a shorter stack caps the action, deeper stacks should not get meaningless extra all-in controls
- Viewer card masking and seat tokens are core integrity safeguards.
- No RLS is enabled as of this handoff; integrity relies on RPC checks and service-role edge execution.

## 9) Current Online UI Behavior

### Portrait
- Table is the primary focus.
- Hero seat is hidden on the felt and rendered in the lower hero area.
- Portrait seat positions are hand-tuned in `PORTRAIT_SEATS` inside `/Users/abishek/Documents/poker-buyins/online/table_app.js`.
- Community cards and pot are vertically staged above the hero area.
- Compact action rail is used for smaller/mobile layouts.

### Landscape
- Landscape has an edge-seated layout intended to preserve the same premium style.
- Top bar can collapse.
- Compact action rail is used instead of a wide bottom action slab.

### Shared UI principles
- Keep hero controls from overlapping critical card visibility.
- Keep winner banner, action labels, and showdown cards from obscuring each other.
- Cache busting for online UI is done by incrementing:
  - `/Users/abishek/Documents/poker-buyins/online-table.html` script query param

## 10) Important Current UX Rules
- `Show Cards` must be the only hero action shown in settled-hand reveal mode.
- Hero pre-actions must never survive into settled `Show Cards` mode.
- Winner banner timing must not start auto-deal countdown at the exact same moment it appears.
- River / street-closing checks and calls need visible hang time before the next reveal phase.
- Board reveal animation should land directly onto board placeholders and avoid double-flip / flicker artifacts.

## 11) Key Database Objects and RPCs

### Tables
- `online_tables`
- `online_table_seats`
- `online_hands`
- `online_hand_players`
- `online_actions`
- `online_hand_events`
- `online_hand_snapshots`
- `online_table_chat_messages`
- `online_table_voice_state`

### High-signal RPCs
- identity / seats:
  - `online_ensure_lobby_player`
  - `online_create_table`
  - `online_join_table`
  - `online_leave_table`
  - `online_claim_table_seat`
- gameplay:
  - `online_start_hand`
  - `online_submit_action`
  - `online_advance_hand`
  - `online_settle_showdown`
  - `online_get_hand_state`
  - `online_get_table_state_viewer`
  - `online_write_hand_snapshot`
- player controls:
  - `online_rebuy_chips`
  - `online_update_table_settings`
  - `online_update_player_preferences`
  - `online_request_turn_grace`
  - `online_set_hand_cards_visibility`
- host controls:
  - `online_kick_table_player`
  - `online_transfer_table_host`
- bot/runtime:
  - `online_get_bot_opponent_profiles`
  - `online_runtime_processable_hands`
  - `online_runtime_due_tables`
  - `online_runtime_start_hand`
- social:
  - `online_post_table_chat_message`
  - `online_start_voice_call`
  - `online_end_voice_call`
  - `online_claim_voice_floor`
  - `online_refresh_voice_floor`
  - `online_release_voice_floor`

## 12) Sessions / History
- Sessions sidebar on the landing page includes:
  - casual
  - group
  - online games
- Online Games lists prior tables and opens a results modal with:
  - player name
  - total in
  - total out
  - final net
- Delete-all-online-games exists in the UI and directly deletes online tables/hands only; it should never touch in-person data.

## 13) Security / Ops Notes
- A service-role key was previously exposed in chat history.
- Treat all old service-role snippets as compromised until rotated.
- If touching voice:
  - Daily secrets must exist in Supabase Edge secrets
  - `DAILY_API_KEY`
  - `DAILY_DOMAIN`
- No RLS yet. Do not pretend the app is hardened beyond RPC checks.

## 14) First Files a New Agent Should Read
1. `/Users/abishek/Documents/poker-buyins/AGENTS.md`
2. `/Users/abishek/Documents/poker-buyins/progress.md`
3. `/Users/abishek/Documents/poker-buyins/online/table_app.js`
4. `/Users/abishek/Documents/poker-buyins/online-table.html`
5. `/Users/abishek/Documents/poker-buyins/supabase/online_poker_schema.sql`
6. `/Users/abishek/Documents/poker-buyins/supabase/functions/online-runtime-tick/index.ts`
7. `/Users/abishek/Documents/poker-buyins/app.js`

## 15) Manual Verification Checklist
- Home Game accordion still works unchanged.
- Online create flow from landing page still works.
- Join by link still works.
- Viewer RPC still masks opponent hole cards before showdown.
- Seat tokens still prevent cross-device seat hijacking.
- Host-only controls remain host-only.
- Auto-deal on/off both work.
- Winner banner → hang time → countdown / Deal flow works.
- Hero `Show Cards` works after settlement and does not coexist with live action buttons.
- Timeouts check when free and fold only when facing a live bet.
- Hand log remains scrollable and readable while the hand is live.
- Table chat persists and late joiners see history.
- Voice can only be used by seated humans.
- `__online_lobby__` never appears in in-person groups.

## 16) Working Style for the Next Agent
- Prefer minimal, surgical fixes.
- Validate assumptions against the repo before changing docs or logic.
- Use migration-safe SQL changes:
  - `drop function if exists ...`
  - recreate
- After changing online JS, bump the `?v=` cache key in `/Users/abishek/Documents/poker-buyins/online-table.html`.
- Run `node --check` on changed JS files before handoff.
- Do not broad-refactor `table_app.js` unless absolutely necessary; it is large but currently the online UI source of truth.
