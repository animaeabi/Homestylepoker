import assert from "node:assert/strict";
import {
  PACING,
  createScheduledCursor,
  createVisibleCursor,
  fastForwardCursors,
  derivePresentationEvents,
  estimateQueueMs,
} from "../online/presentation.js";

const action = (seq, type = "call") => ({ event_type: "action_taken", seq, payload: { action_type: type } });
const hand = (id, state, boardCards = [], extra = {}) => ({ id, state, board_cards: boardCards, ...extra });

// --- 1) Normal street advance: two actions then the flop, in order. ---------
{
  const scheduled = createScheduledCursor();
  const visible = createVisibleCursor();
  // Hand starts preflop, no board.
  let evs = derivePresentationEvents({ scheduled, visible, hand: hand("h1", "preflop"), events: [], contested: false });
  assert.deepEqual(evs.map((e) => e.type), ["hand_start"]);

  evs = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h1", "flop", ["AS", "KD", "2C"]),
    events: [action(1, "call"), action(2, "check")],
    contested: false,
  });
  assert.deepEqual(evs.map((e) => e.type), ["action", "action", "street_close", "board_reveal"]);
  assert.equal(evs[3].street, "flop");
  assert.deepEqual(evs[3].indices, [0, 1, 2]);
  assert.equal(evs[2].aggressive, false);

  // Duplicate snapshot: nothing new derives.
  const dup = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h1", "flop", ["AS", "KD", "2C"]),
    events: [action(1), action(2)],
    contested: false,
  });
  assert.deepEqual(dup, []);
}

// --- 2) All-in runout in ONE snapshot: sequential streets + showdown. -------
{
  const scheduled = createScheduledCursor();
  const visible = createVisibleCursor();
  derivePresentationEvents({ scheduled, visible, hand: hand("h2", "preflop"), events: [], contested: false });
  const evs = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h2", "settled", ["AS", "KD", "2C", "9H", "9S"]),
    events: [action(3, "all_in"), action(4, "call")],
    contested: true,
  });
  assert.deepEqual(
    evs.map((e) => e.type),
    ["action", "action", "street_close", "board_reveal", "board_reveal", "board_reveal", "showdown_tension", "showdown_ready"],
  );
  const streets = evs.filter((e) => e.type === "board_reveal").map((e) => e.street);
  assert.deepEqual(streets, ["flop", "turn", "river"]);
  assert.equal(evs.filter((e) => e.type === "board_reveal")[2].runout, true);
  assert.equal(evs[2].aggressive, false); // closing action was the call
  // Every id unique.
  assert.equal(new Set(evs.map((e) => e.id)).size, evs.length);
}

// --- 3) Fresh load fast-forwards: no replay, visible = authoritative. -------
{
  const scheduled = createScheduledCursor();
  const visible = createVisibleCursor();
  fastForwardCursors(scheduled, visible, hand("h3", "turn", ["AS", "KD", "2C", "9H"]), [action(1), action(9)]);
  assert.equal(visible.boardCount, 4);
  assert.equal(visible.showdownAllowed, true);
  const evs = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h3", "turn", ["AS", "KD", "2C", "9H"]),
    events: [action(1), action(9)],
    contested: false,
  });
  assert.deepEqual(evs, []); // nothing replays
  // The NEXT real change still presents.
  const next = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h3", "river", ["AS", "KD", "2C", "9H", "3D"]),
    events: [action(1), action(9), action(10, "bet")],
    contested: false,
  });
  assert.deepEqual(next.map((e) => e.type), ["action", "street_close", "board_reveal"]);
  assert.equal(next[1].aggressive, true);
  assert.equal(next[2].street, "river");
  assert.deepEqual(next[2].indices, [4]);
}

// --- 4) New hand resets cursors; old-hand progress can't leak. --------------
{
  const scheduled = createScheduledCursor();
  const visible = createVisibleCursor();
  fastForwardCursors(scheduled, visible, hand("h4", "settled", ["AS", "KD", "2C", "9H", "3D"]), [action(8)]);
  const evs = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h5", "preflop"),
    events: [action(1, "raise")],
    contested: false,
  });
  assert.equal(evs[0].type, "hand_start");
  assert.equal(scheduled.handId, "h5");
  assert.equal(visible.boardCount, 0);
  assert.equal(visible.showdownAllowed, false);
  assert.equal(evs.filter((e) => e.type === "action").length, 1);
}

// --- 5) Catch-up cap: deep history skipped as explicit policy. --------------
{
  const scheduled = createScheduledCursor();
  const visible = createVisibleCursor();
  derivePresentationEvents({ scheduled, visible, hand: hand("h6", "preflop"), events: [], contested: false });
  const many = Array.from({ length: 9 }, (_, i) => action(i + 1));
  const evs = derivePresentationEvents({ scheduled, visible, hand: hand("h6", "preflop"), events: many, contested: false });
  const actions = evs.filter((e) => e.type === "action");
  assert.equal(actions.length, PACING.actionCatchupLimit);
  assert.equal(actions[actions.length - 1].raw.seq, 9);
  assert.equal(scheduled.actionSeq, 9); // skipped ones never come back
}

// --- 6) Fold-win: no showdown events for an uncontested settle. -------------
{
  const scheduled = createScheduledCursor();
  const visible = createVisibleCursor();
  derivePresentationEvents({ scheduled, visible, hand: hand("h7", "preflop"), events: [], contested: false });
  const evs = derivePresentationEvents({
    scheduled, visible,
    hand: hand("h7", "settled", []),
    events: [action(1, "all_in"), action(2, "fold")],
    contested: false,
  });
  assert.deepEqual(evs.map((e) => e.type), ["action", "action"]);
}

// --- 7) Duration estimates are sane and capped. ------------------------------
{
  const queue = [
    { type: "action" },
    { type: "street_close", aggressive: true },
    { type: "board_reveal", indices: [0, 1, 2] },
    { type: "showdown_tension" },
  ];
  const ms = estimateQueueMs(queue);
  assert.ok(ms > 2000 && ms <= PACING.maxResultDelayMs, `unexpected estimate ${ms}`);
  assert.equal(estimateQueueMs([]), 0);
}

console.log("presentation ledger tests passed");
