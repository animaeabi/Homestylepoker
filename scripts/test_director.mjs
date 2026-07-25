// Conversation-director tests: silence budget, target rotation, semantic
// repetition, and emotionally-matched delivery cues. The module under test is
// TypeScript (shared with the edge runtime), so it's transpiled to a temp
// bundle first -- same pattern the deploy uses.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const outDir = mkdtempSync(path.join(tmpdir(), "director-test-"));
const outFile = path.join(outDir, "table_memory.mjs");
execSync(
  `npx esbuild supabase/functions/_shared/table_memory.ts --bundle --format=esm --platform=neutral --outfile=${outFile}`,
  { stdio: "pipe" },
);
const {
  emptyTableMemory,
  tooSimilar,
  convoRepetitive,
  noteConvoLine,
  targetFatigued,
  tableBudgetBlocked,
  deliveryCueFor,
} = await import(outFile);

// --- 1) Semantic similarity: same idea in different words is a repeat. ------
{
  assert.equal(tooSimilar("that river card saved your whole night", "the river card saved your night"), true);
  assert.equal(tooSimilar("nice bluff, show us next time", "cute bluff -- show it next time"), true);
  assert.equal(tooSimilar("brutal beat", "someone order coffee, this table is freezing"), false);
  assert.equal(tooSimilar("hah.", "wow."), false); // too little substance to compare
}

// --- 2) convoRepetitive: exact + near matches within the window. ------------
{
  const mem = emptyTableMemory();
  noteConvoLine(mem, { by: "donk", text: "That river card saved your whole night.", hand: 3 });
  assert.equal(convoRepetitive(mem, "donk", "That river card saved your whole night."), true, "exact repeat");
  assert.equal(convoRepetitive(mem, "donk", "the river card really saved your night"), true, "same idea, same speaker");
  assert.equal(convoRepetitive(mem, "grease", "anyone else notice the felt is sticky"), false, "fresh topic passes");
  // A different speaker echoing the idea much later is fine.
  mem.convo.lines[0].t = Date.now() - 3 * 60 * 1000;
  assert.equal(convoRepetitive(mem, "grease", "that river saved your night, friend"), false, "other speaker after window");
}

// --- 3) Target rotation: one player must not stay the whole story. ----------
{
  const mem = emptyTableMemory();
  noteConvoLine(mem, { by: "donk", text: "line one here", hand: 1, target: "Abi" });
  noteConvoLine(mem, { by: "holes", text: "line two here", hand: 1, target: "Abi" });
  assert.equal(targetFatigued(mem, "Abi"), false, "two hits is fine");
  noteConvoLine(mem, { by: "grease", text: "line three here", hand: 2, target: "Abi" });
  assert.equal(targetFatigued(mem, "Abi"), true, "three of last four is fatigue");
  assert.equal(targetFatigued(mem, "Pony"), false, "other targets unaffected");
  noteConvoLine(mem, { by: "donk", text: "line four here", hand: 2, target: "Pony" });
  noteConvoLine(mem, { by: "donk", text: "line five here", hand: 2, target: "Pony" });
  assert.equal(targetFatigued(mem, "Abi"), false, "rotation clears the fatigue");
}

// --- 4) Speech budget: silence is the default; chains are exempt. -----------
{
  const mem = emptyTableMemory();
  assert.equal(tableBudgetBlocked(mem, 5), false, "quiet table lets anyone speak");
  noteConvoLine(mem, { by: "donk", text: "opening remark", hand: 1 });
  assert.equal(tableBudgetBlocked(mem, 5), true, "weak line right after a line dies");
  assert.equal(tableBudgetBlocked(mem, 1), false, "direct reply chains always flow");
  mem.convo.lastAnyAt = Date.now() - 3000;
  assert.equal(tableBudgetBlocked(mem, 2), false, "strong moment after 3s passes");
  assert.equal(tableBudgetBlocked(mem, 5), true, "ambient still waits");
  mem.convo.lastAnyAt = Date.now() - 10000;
  assert.equal(tableBudgetBlocked(mem, 5), false, "ambient free after the gap");
}

// --- 5) Delivery cues: post-loss cooldown, not instant theatrics. ------------
{
  const mem = emptyTableMemory();
  mem.hands = 10;
  mem.emo.hellsmouth = { n: "Fill", s: "tilted", i: 2, streak: -2, hand: 10 };
  assert.equal(deliveryCueFor(mem, "hellsmouth", "anger"), "deflated", "fresh big loss reads deflated");
  mem.emo.hellsmouth.hand = 5; // loss long digested
  assert.notEqual(deliveryCueFor(mem, "hellsmouth", "anger"), "deflated", "stale loss can be theatrical again");
  mem.emo.grease = { n: "Grease", s: "frustrated", i: 1, streak: -1, hand: 10 };
  assert.equal(deliveryCueFor(mem, "grease", "win"), "restrained", "frustrated winner stays low-key");
  assert.equal(deliveryCueFor(mem, "grease", "needle"), "clipped", "frustrated needle bites short");
  mem.emo.eyev = { n: "Finn", s: "confident", i: 1, streak: 3, hand: 10 };
  assert.equal(deliveryCueFor(mem, "eyev", "needle"), "amused", "heater needle is quietly amused");
  assert.equal(deliveryCueFor(mem, "nobody", "win"), null, "no emotional state, default read");
}

// --- 6) Line log stays bounded. ----------------------------------------------
{
  const mem = emptyTableMemory();
  for (let i = 0; i < 30; i += 1) {
    noteConvoLine(mem, { by: "donk", text: `unique remark number ${i} about topic ${i}`, hand: i, target: i % 2 ? "Abi" : null });
  }
  assert.ok(mem.convo.lines.length <= 14, "line log capped");
  assert.ok(mem.convo.targets.length <= 8, "target log capped");
}

console.log("conversation director tests passed");
