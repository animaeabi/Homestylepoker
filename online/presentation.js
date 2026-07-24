// Presentation ledger: the single source of truth for WHAT the player is
// allowed to see next, and in what order.
//
// The server is authoritative and fast -- a final call, the street advance,
// the full runout and the settlement can all arrive in ONE snapshot. The old
// client tried to reconstruct pacing by diffing consecutive snapshots inside
// several independent subsystems (announcements, board reveals, label holds,
// popups), which is why actions collapsed, cards appeared early, and sounds
// drifted. This module replaces the DERIVATION layer: presentation events are
// computed from the gap between what has been PRESENTED and what the server
// says is true -- never from a snapshot pair. Missed snapshots, duplicate
// refreshes and throttled tabs therefore cannot lose or duplicate a beat.
//
// The module is intentionally pure (no DOM, no timers) so it can be unit
// tested in node: the table_app controller executes the events it derives.
//
// Event identity: every event carries a stable id (`a:<hand>:<seq>`,
// `b:<hand>:<street>`, ...) and the cursors themselves make re-derivation
// impossible -- an event exists exactly once because deriving it advances the
// `scheduled` cursor past it.

// ---------------------------------------------------------------------------
// Central pacing configuration (stage-3 hook: every scheduler-owned duration
// lives here; the per-card board flight/flip profiles remain with the board
// animation, which reports its total duration back to the scheduler).
// ---------------------------------------------------------------------------
export const PACING = {
  // Per-action banner cadence -- matches the announcement flush (760ms visible
  // + gap). The scheduler waits this long per action so the banner queue and
  // the event queue stay in lockstep without sharing timers.
  actionBannerMs: 880,
  // Breath after the action that CLOSES a street, before board cards move.
  streetClose: {
    defaultMs: 700,
    passiveMs: 520,   // a closing check/call breathes a little less
    aggressiveMs: 920, // a closing bet/raise/all-in hangs in the air longer
  },
  // Tension hold between the last presented beat and hole cards turning over.
  showdownTensionMs: 700,
  // Ceiling for how much queued presentation the winner popup / settlement FX
  // will wait on (safety: a stuck animation must never postpone results
  // forever).
  maxResultDelayMs: 16000,
  // How many missed actions are presented after a gap; older history is
  // deliberately skipped (recovery policy, not an accident).
  actionCatchupLimit: 4,
};

const BOARD_STREETS = [
  { street: "flop", start: 0, end: 3 },
  { street: "turn", start: 3, end: 4 },
  { street: "river", start: 4, end: 5 },
];

// ---------------------------------------------------------------------------
// Presented-state cursors.
//   scheduled: what has been HANDED to the scheduler (dedup cursor).
//   visible:   what renders may show right now (advanced by executors).
// ---------------------------------------------------------------------------
export function createScheduledCursor() {
  return { handId: null, actionSeq: 0, boardCount: 0, showdownQueued: false };
}

export function createVisibleCursor() {
  return { handId: null, boardCount: 0, showdownAllowed: false };
}

// Fast-forward both cursors to the authoritative snapshot -- used on fresh
// load / reconnect, where replaying history would be wrong. This is the
// explicit recovery policy: skip the past, present the present.
export function fastForwardCursors(scheduled, visible, hand, events) {
  const handId = hand?.id || null;
  const board = Array.isArray(hand?.board_cards) ? hand.board_cards : [];
  const maxSeq = (events || []).reduce(
    (max, ev) => (ev?.event_type === "action_taken" ? Math.max(max, Number(ev.seq || 0)) : max),
    0,
  );
  scheduled.handId = handId;
  scheduled.actionSeq = maxSeq;
  scheduled.boardCount = board.length;
  scheduled.showdownQueued = true;
  visible.handId = handId;
  visible.boardCount = board.length;
  visible.showdownAllowed = true;
}

function resetCursorsForHand(scheduled, visible, handId) {
  scheduled.handId = handId;
  scheduled.actionSeq = 0;
  scheduled.boardCount = 0;
  scheduled.showdownQueued = false;
  visible.handId = handId;
  visible.boardCount = 0;
  visible.showdownAllowed = false;
}

function isAggressiveAction(raw) {
  const t = String(raw?.payload?.action_type || "");
  return t === "bet" || t === "raise" || t === "all_in";
}

// ---------------------------------------------------------------------------
// Event derivation. Consumes the gap between `scheduled` and the snapshot,
// advances `scheduled`, and returns the ordered fresh events.
// ---------------------------------------------------------------------------
export function derivePresentationEvents({ scheduled, visible, hand, events, contested }) {
  const out = [];
  if (!hand?.id) {
    resetCursorsForHand(scheduled, visible, null);
    return out;
  }

  if (hand.id !== scheduled.handId) {
    resetCursorsForHand(scheduled, visible, hand.id);
    out.push({ id: `h:${hand.id}:start`, type: "hand_start", handId: hand.id });
  }

  // 1) Actions: every unseen action presents, in order, capped by the
  //    catch-up policy (skipped ones still advance the cursor).
  const newActions = (events || [])
    .filter((ev) => ev?.event_type === "action_taken" && Number(ev.seq || 0) > scheduled.actionSeq)
    .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  if (newActions.length) {
    scheduled.actionSeq = Number(newActions[newActions.length - 1].seq || scheduled.actionSeq);
    for (const raw of newActions.slice(-PACING.actionCatchupLimit)) {
      out.push({
        id: `a:${hand.id}:${raw.seq}`,
        type: "action",
        handId: hand.id,
        raw,
      });
    }
  }
  const lastActionRaw = newActions.length ? newActions[newActions.length - 1] : null;

  // 2) Board: streets between what was scheduled and what the server holds.
  //    An all-in runout arriving as one snapshot becomes SEQUENTIAL street
  //    reveals; the executor supplies per-street pacing.
  const board = Array.isArray(hand.board_cards) ? hand.board_cards : [];
  const runout = ["showdown", "settled"].includes(String(hand.state || ""));
  if (board.length > scheduled.boardCount) {
    let closedOnce = false;
    for (const chunk of BOARD_STREETS) {
      if (chunk.end <= scheduled.boardCount || chunk.start >= board.length) continue;
      const indices = [];
      for (let i = Math.max(chunk.start, scheduled.boardCount); i < Math.min(chunk.end, board.length); i += 1) {
        indices.push(i);
      }
      if (!indices.length) continue;
      // One street-close breath before board movement begins; between runout
      // streets the reveal profiles themselves carry the pauses.
      if (!closedOnce) {
        out.push({
          id: `c:${hand.id}:${chunk.street}`,
          type: "street_close",
          handId: hand.id,
          aggressive: isAggressiveAction(lastActionRaw),
          hadActions: newActions.length > 0,
          fromStreet: { flop: "preflop", turn: "flop", river: "turn" }[chunk.street] || null,
        });
        closedOnce = true;
      }
      out.push({
        id: `b:${hand.id}:${chunk.street}`,
        type: "board_reveal",
        handId: hand.id,
        street: chunk.street,
        indices,
        runout,
      });
    }
    scheduled.boardCount = board.length;
  }

  // 3) Showdown: tension beat, then hole cards become eligible. Only for a
  //    contested showdown -- fold-wins have nothing to turn over.
  if (!scheduled.showdownQueued && contested && runout) {
    scheduled.showdownQueued = true;
    out.push({ id: `t:${hand.id}:tension`, type: "showdown_tension", handId: hand.id });
    out.push({ id: `s:${hand.id}:showdown`, type: "showdown_ready", handId: hand.id });
  }

  return out;
}

// Duration the scheduler will spend on an event (board reveals report their
// real duration at execution time; this estimate feeds result-delay math).
export function estimateEventMs(event, boardRevealEstimator = null) {
  switch (event?.type) {
    case "action": return PACING.actionBannerMs;
    case "street_close": return event.aggressive ? PACING.streetClose.aggressiveMs : PACING.streetClose.defaultMs;
    case "board_reveal": {
      if (typeof boardRevealEstimator === "function") {
        const ms = Number(boardRevealEstimator(event));
        if (Number.isFinite(ms) && ms > 0) return ms;
      }
      // Rough per-card fallback; the executor uses the animation's own total.
      return 1100 * Math.max(1, (event.indices || []).length);
    }
    case "showdown_tension": return PACING.showdownTensionMs;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Presentation weight (stage 3): pacing responds to the importance of the
// moment. A 1.5bb preflop steal moves briskly; a 40bb river spot breathes; an
// all-in carries the most weight. Executors multiply their durations by this.
// ---------------------------------------------------------------------------
export function presentationWeight({ potBb = 0, allIn = false, showdown = false } = {}) {
  if (potBb < 4 && !allIn) return 0.85; // routine pots stay brisk
  let w = 1;
  if (potBb >= 12) w += 0.15;
  if (potBb >= 30) w += 0.2;
  if (potBb >= 60) w += 0.15;
  if (allIn) w += 0.25;
  if (showdown) w += 0.1;
  return Math.min(1.8, w);
}

export function estimateQueueMs(queue, boardRevealEstimator = null) {
  let total = 0;
  for (const ev of queue || []) total += estimateEventMs(ev, boardRevealEstimator);
  return Math.min(PACING.maxResultDelayMs, total);
}
