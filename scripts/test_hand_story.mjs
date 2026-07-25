// Hand Story tests: the canonical settled-hand narration every speech path
// draws from. TypeScript module -> transpiled to a temp bundle first.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const outDir = mkdtempSync(path.join(tmpdir(), "hand-story-test-"));
const outFile = path.join(outDir, "hand_story.mjs");
execSync(
  `npx esbuild supabase/functions/_shared/hand_story.ts --bundle --format=esm --platform=neutral --outfile=${outFile}`,
  { stdio: "pipe" },
);
const { buildHandStory, cardWord } = await import(outFile);

const names = new Map([["g1", "Abi"], ["g2", "Tommy Donk"], ["g3", "Finn Eyev"]]);
const act = (gpid, type, amount = 0) => ({ event_type: "action_taken", actor_group_player_id: gpid, payload: { action_type: type, amount } });
const street = () => ({ event_type: "street_dealt", payload: {} });

// --- 1) Jam-steal hand: honest pot, no showdown, shown junk goes face-up. ---
{
  const story = buildHandStory({
    handNo: 44,
    bigBlind: 2,
    boardCards: [],
    players: [
      { name: "Abi", isBot: false, folded: false, holeCards: ["Ad", "2d"], manuallyShown: true, netBb: 1.5, committedBb: 314 },
      { name: "Tommy Donk", isBot: true, folded: true, holeCards: ["8h", "3s"], netBb: -0.5, committedBb: 0.5 },
      { name: "Finn Eyev", isBot: true, folded: true, holeCards: ["9d", "5h"], netBb: -1, committedBb: 1 },
    ],
    events: [act("g1", "all_in", 628), act("g2", "fold"), act("g3", "fold")],
    nameByGpid: names,
  });
  assert.ok(story.text.includes("Hand #44"), "hand number present");
  assert.ok(/Abi shoved ALL IN/.test(story.text), "jam narrated");
  assert.ok(/small pot/.test(story.text), "HONEST pot: blinds steal is small, not the refunded jam");
  assert.ok(!/monster/.test(story.text), "no phantom monster pot");
  assert.ok(/no showdown|nobody paid/i.test(story.text), "uncontested is explicit");
  assert.ok(story.text.includes("ace of diamonds and deuce of diamonds"), "shown cards named in words");
  assert.equal(story.faceUp.length, 1, "only the voluntary show is public");
  assert.ok(story.own["Tommy Donk"].includes("eight of hearts"), "bot knows its own muck");
  assert.ok(!story.own["Abi"], "human muck lines are only for bots");
}

// --- 2) Showdown hand: reveals are public, made hands evaluated vs board. ---
{
  const story = buildHandStory({
    handNo: 40,
    bigBlind: 2,
    boardCards: ["Ts", "4s", "6d", "4h", "Jh"],
    players: [
      { name: "Abi", isBot: false, folded: false, holeCards: ["Qh", "6s"], netBb: 111, committedBb: 112 },
      { name: "Tommy Donk", isBot: true, folded: false, holeCards: ["Kc", "Qc"], netBb: -110, committedBb: 110 },
    ],
    events: [act("g1", "all_in", 224), act("g2", "call", 224), street(), street(), street()],
    nameByGpid: names,
  });
  assert.equal(story.faceUp.length, 2, "both showdown hands are face-up");
  const abi = story.faceUp.find((f) => f.name === "Abi");
  const donk = story.faceUp.find((f) => f.name === "Tommy Donk");
  assert.ok(/Two Pair/i.test(abi.made), "Q6 on Ts4s6d4hJh reads two pair");
  assert.ok(/One Pair \(4\)/i.test(donk.made), "KQ plays the board's pair of fours -- evaluated honestly");
  assert.ok(/huge pot|monster pot|big pot/.test(story.text), "real big pot reads big");
  assert.ok(/at showdown/.test(story.text), "showdown is explicit");
}

// --- 3) Street segmentation + caps. ------------------------------------------
{
  const story = buildHandStory({
    handNo: 7,
    bigBlind: 2,
    boardCards: ["8c", "2s", "Tc"],
    players: [
      { name: "Abi", isBot: false, folded: true, holeCards: ["Jd", "4d"], netBb: -1, committedBb: 1 },
      { name: "Finn Eyev", isBot: true, folded: false, holeCards: ["Td", "8h"], netBb: 1.5, committedBb: 1 },
    ],
    events: [act("g1", "call", 2), act("g3", "check"), street(), act("g3", "bet", 4), act("g1", "fold")],
    nameByGpid: names,
  });
  assert.ok(/preflop:/.test(story.text), "preflop tagged");
  assert.ok(/flop:/.test(story.text), "flop tagged");
  assert.ok(story.text.indexOf("preflop:") < story.text.indexOf("flop:"), "streets in order");
  assert.ok(story.text.length <= 900, "narration capped");
  assert.ok(story.own["Finn Eyev"] === undefined, "winner has no muck line");
}

assert.equal(cardWord("Th"), "ten of hearts");
console.log("hand story tests passed");
