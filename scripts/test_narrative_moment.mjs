import assert from "node:assert/strict";
import {
  freezeNarrativeMoment,
  narrativeMomentPrompt,
  prepareNarrativeDelivery,
  NARRATIVE_DELIVERY,
} from "../supabase/functions/_shared/narrative_moment.js";

const now = 1_000_000;
const moment = freezeNarrativeMoment({
  sourceHandId: "hand-20",
  sourceEventSeq: 44,
  sourcePhase: "settle_result",
  momentType: "hero_call",
  street: "river",
  potBb: 54,
  actor: { name: "Abishek", action: "call", amountBb: 18 },
  opponent: { name: "Pony Gee", action: "bet", amountBb: 18 },
  result: { winner: "Abishek", loser: "Pony Gee", caughtBluff: true },
  board: ["AS", "7D", "4C", "JH", "2S"],
  contextSummary: "Abishek's 18bb river hero call on Pony Gee in a 54bb pot",
}, { now, immediateMs: 12_000, callbackMs: 90_000 });

assert.equal(Object.isFrozen(moment), true);
assert.equal(Object.isFrozen(moment.actor), true);
assert.match(narrativeMomentPrompt(moment), /hand-20/);
assert.match(narrativeMomentPrompt(moment), /54/);

const immediate = prepareNarrativeDelivery({
  moment,
  text: "You just called me with that?",
  mood: "regret",
  currentHand: { id: "hand-20", state: "settled" },
  now: now + 4_000,
});
assert.equal(immediate.mode, NARRATIVE_DELIVERY.IMMEDIATE);
assert.equal(immediate.text, "You just called me with that?");
assert.equal(immediate.mood, "regret");

const callback = prepareNarrativeDelivery({
  moment,
  text: "You just called me with that?",
  mood: "regret",
  currentHand: { id: "hand-21", state: "preflop" },
  currentHasAction: false,
  now: now + 25_000,
});
assert.equal(callback.mode, NARRATIVE_DELIVERY.CALLBACK);
assert.equal(callback.mood, "callback");
assert.match(callback.text, /still thinking/i);
assert.match(callback.text, /river hero call/i);
assert.doesNotMatch(callback.text, /\bjust\b/i);

const busyNextHand = prepareNarrativeDelivery({
  moment,
  text: "You just called me with that?",
  currentHand: { id: "hand-21", state: "preflop" },
  currentHasAction: true,
  now: now + 25_000,
});
assert.equal(busyNextHand.mode, NARRATIVE_DELIVERY.MEMORY_ONLY);
assert.equal(busyNextHand.text, "");

const expired = prepareNarrativeDelivery({
  moment,
  text: "You just called me with that?",
  currentHand: { id: "hand-21", state: "preflop" },
  currentHasAction: false,
  now: now + 95_000,
});
assert.equal(expired.mode, NARRATIVE_DELIVERY.MEMORY_ONLY);

const privateThought = freezeNarrativeMoment({
  ...moment,
  callbackEligible: false,
}, { now, immediateMs: 8_000, callbackMs: 90_000 });
const lateThought = prepareNarrativeDelivery({
  moment: privateThought,
  text: "I knew the river changed him.",
  mood: "thought",
  currentHand: { id: "hand-21", state: "preflop" },
  currentHasAction: false,
  now: now + 10_000,
});
assert.equal(lateThought.mode, NARRATIVE_DELIVERY.MEMORY_ONLY);

console.log("narrative moment delivery tests passed");
