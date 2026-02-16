# Online Poker MVP Blueprint

This document defines a non-breaking path to add **online play** while keeping the existing in-person tracker intact.

## Product Modes

- **In-person tracker (existing):** unchanged behavior.
- **Online table (new):** group-based real-time poker with server-authoritative outcomes.

## Core Decision: Trust Boundary

For online play, clients are untrusted.

- Client responsibilities:
  - render state
  - collect user input
  - send intents (`fold`, `call`, `raise`, etc.)
- Server responsibilities:
  - deck generation + shuffle
  - deal order + private card routing
  - action legality
  - pot/side-pot math
  - showdown + settlement
  - event log + snapshots

This avoids cheat vectors from client-side game logic.

## Reuse from Current App

- Keep `groups` + `group_players` as identity/community model.
- Keep historical stats concepts and extend with online game sources.
- Keep UI brand/theme.

## MVP Scope (Phase 1)

- Variant: **Texas Hold'em (No-Limit)**
- Seats: up to 6
- Play money chips only
- One table per group to start
- Reconnect support (resume from snapshot + event delta)

Out of scope for MVP:

- multi-table tournaments
- rake logic
- bots
- real-money cash ledger

## Hand Lifecycle (State Machine)

1. `waiting_for_players`
2. `hand_init`
3. `post_blinds`
4. `deal_hole`
5. `preflop`
6. `flop`
7. `turn`
8. `river`
9. `showdown` (if needed)
10. `settled`

All transitions are written as append-only events.

## Event-Sourced Model

Per hand, persist ordered events with `seq`:

- `hand_started`
- `blind_posted`
- `hole_dealt`
- `action_taken`
- `street_dealt`
- `pot_awarded`
- `hand_settled`

Server builds current hand state from:

- latest snapshot (optional)
- remaining events

Benefits:

- deterministic replay
- dispute/debug capability
- resilient reconnect

## Security / Fairness Baseline

- use cryptographic randomness (`crypto` APIs on server)
- never use `Math.random()` for online outcomes
- enforce all action validation server-side
- every action has actor identity + hand `seq` checks
- reject out-of-turn or stale actions

## Network Protocol (MVP)

- WebSocket channel per online table
- messages:
  - `table_snapshot`
  - `event_delta`
  - `action_intent`
  - `action_rejected`
  - `resync_required`

Client reconnect flow:

1. reconnect with session token
2. send `last_seen_seq`
3. receive delta or full snapshot

## UI Integration Plan

- Add `Online` switch at group level later (not in this commit)
- Entering online mode opens a dedicated online table screen
- Existing tracker pages remain unchanged

## Milestones

### M1 (this repo foundation)

- SQL schema for online tables/hands/events
- JS engine scaffold (deterministic core + action validator stubs)
- docs + implementation contract

### M2

- server runtime for table loop (authoritative)
- websocket action routing
- hand state transitions (preflop to river)

## M2 RPC Contract (implemented in `supabase/online_poker_schema.sql`)

Table lifecycle:

- `online_create_table(group_id, name, creator, blinds, max_seats)`
- `online_join_table(table_id, group_player_id, preferred_seat, chip_stack)`
- `online_leave_table(table_id, group_player_id)`

Hand lifecycle:

- `online_start_hand(table_id, started_by_group_player_id)`
- `online_submit_action(hand_id, actor_group_player_id, action_type, amount, client_action_id)`
- `online_advance_hand(hand_id, actor_group_player_id, reason)`
- `online_get_hand_state(hand_id, since_seq)`
- `online_write_hand_snapshot(hand_id)`

Notes:

- All writes are append-only event driven (`online_hand_events` with monotonically increasing `seq`).
- `client_action_id` supports idempotent action retries.
- Snapshot reads are designed for reconnect flow (`last_seen_seq` -> `online_get_hand_state` delta).

## Backend Status (current)

Implemented:

- Table lifecycle RPCs (`create/join/leave`)
- Hand bootstrapping with:
  - button/small blind/big blind assignment
  - shuffled 52-card deck
  - hole card dealing
  - blind posting
- Turn-validated action ingestion:
  - fold/check/call/bet/raise/all-in
  - turn ownership enforcement
  - min-raise and stack constraints
- Round transitions:
  - preflop -> flop -> turn -> river
  - board dealing from remaining deck
  - showdown-ready transition
- Fast-path settlement when everyone else folds
- Event + snapshot persistence on each transition
- Showdown settlement RPC (`online_settle_showdown`) with strict payout sum validation
- Table state aggregate RPC (`online_get_table_state`)
- Runtime worker for backend-only automation:
  - auto-advance streets when no actor remains (`allin_progress`)
  - auto-resolve showdown payouts and settle hands
  - file: `/Users/abishek/Documents/poker-buyins/online/runtime_worker.js`

Showdown resolver helper (server-side):

- `/Users/abishek/Documents/poker-buyins/online/showdown.js`
- `/Users/abishek/Documents/poker-buyins/online/settle_showdown.js`

These compute side-pot payouts from board + hole cards and feed `online_settle_showdown`.

Runtime worker test helper:

- `/Users/abishek/Documents/poker-buyins/online/runtime_worker.test.js`

### M3

- reconnect snapshot/delta websocket fan-out
- basic anti-collusion telemetry hooks

### M4

- production hardening
- RLS + auth integration
- observability (error + event metrics)

## Backward Compatibility

Current tracker tables and flows are untouched.

New online schema is additive only.
