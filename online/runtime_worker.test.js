import assert from "node:assert/strict";
import { processHandForRuntime, runRuntimeTick } from "./runtime_worker.js";

async function testShowdownSettles() {
  const calls = [];
  const client = {
    getHandState: async () => ({
      hand: { board_cards: ["AS", "KS", "QS", "JS", "2D"] },
      players: [
        { seat_no: 1, folded: false, committed: 100, hole_cards: ["TS", "3S"] },
        { seat_no: 2, folded: false, committed: 100, hole_cards: ["AH", "AD"] }
      ]
    }),
    settleShowdown: async (payload) => {
      calls.push(payload);
      return { id: payload.handId, state: "settled" };
    }
  };

  const result = await processHandForRuntime(client, {
    id: "hand-1",
    state: "showdown",
    action_seat: null
  });

  assert.equal(result.settled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].handId, "hand-1");
}

async function testAllInAdvanceThenSettle() {
  let advances = 0;
  let settled = 0;
  const client = {
    advanceHand: async () => {
      advances += 1;
      return advances < 2
        ? { state: "turn", action_seat: null }
        : { state: "showdown", action_seat: null };
    },
    getHandState: async () => ({
      hand: { board_cards: ["AS", "KS", "QS", "JS", "2D"] },
      players: [
        { seat_no: 1, folded: false, committed: 50, hole_cards: ["TS", "3S"] },
        { seat_no: 2, folded: false, committed: 50, hole_cards: ["AH", "AD"] }
      ]
    }),
    settleShowdown: async () => {
      settled += 1;
      return { state: "settled" };
    }
  };

  const result = await processHandForRuntime(client, {
    id: "hand-2",
    state: "flop",
    action_seat: null
  });

  assert.equal(advances, 2);
  assert.equal(settled, 1);
  assert.equal(result.settled, true);
}

async function testRuntimeTickSummary() {
  const client = {
    listProcessableHands: async () => [
      { id: "a", state: "preflop", action_seat: 3 },
      { id: "b", state: "showdown", action_seat: null }
    ],
    getHandState: async () => ({
      hand: { board_cards: ["AS", "KS", "QS", "JS", "2D"] },
      players: [
        { seat_no: 1, folded: false, committed: 20, hole_cards: ["TS", "3S"] },
        { seat_no: 2, folded: false, committed: 20, hole_cards: ["AH", "AD"] }
      ]
    }),
    settleShowdown: async () => ({ state: "settled" })
  };

  const report = await runRuntimeTick(client, {});
  assert.equal(report.scanned, 2);
  assert.equal(report.settled, 1);
  assert.equal(report.errors.length, 0);
}

async function run() {
  await testShowdownSettles();
  await testAllInAdvanceThenSettle();
  await testRuntimeTickSummary();
  console.log("runtime worker tests passed");
}

run();
