// Living table history: what the characters remember, feel, and call back to.
//
// One JSONB blob per table (online_tables.banter_memory), written only by the
// runtime at settle time (single writer), read by every chat/banter/thought
// prompt. Three layers, mirroring how real table memory works:
//   - events: notable moments (caught bluffs, hero calls, coolers, steals),
//     weighted so the sharpest memories surface in prompts the longest.
//   - emo: per-character emotional state that drifts hand to hand -- losses
//     and public embarrassments stack toward tilt, wins bleed it off. Gradual
//     by design: one ordinary lost pot never flips anyone to furious.
//   - human: simple reads on each human player (fold streaks, vpip-ish, tank
//     count, showdown record) so characters can needle the nit or fear the
//     station like real regulars would.
//
// Everything is display-name based (names are stable within a table) so the
// prompt builder can drop lines in verbatim with zero joins.

import { describeSevenCardHand } from "./showdown.ts";

export type MemEvent = {
  t: string;      // bluff_called | hero_call | cooler | big_pot | steal | big_loss | tank
  hand: number;   // hand number when it happened
  note: string;   // prompt-ready line, names inlined
  w: number;      // weight: 3 = table legend, 1 = footnote
};

export type CharEmotion = {
  n: string;          // display name (for cross-character prompt lines)
  s: "neutral" | "confident" | "frustrated" | "tilted";
  i: number;          // intensity 0..3
  streak: number;     // +wins / -losses in big pots, consecutive
  hand: number;       // last hand that moved this state
};

export type HumanRead = {
  hands: number;
  vpip: number;          // hands they voluntarily played
  pfFoldStreak: number;  // consecutive hands folded without playing
  sdWon: number;
  sdLost: number;
  tanks: number;
};

// Directional relationship: how `from` (a display name) currently feels about
// `to`. Directional on purpose -- Pony can respect Finn while Finn just finds
// Pony exhausting. score runs -3 (open grudge) .. +3 (real respect); `why` is
// the last event that moved it, prompt-ready.
export type Relation = { score: number; why: string; hand: number };

export type TableMemory = {
  v: number;
  hands: number;
  events: MemEvent[];
  emo: Record<string, CharEmotion>;   // by characterId
  human: Record<string, HumanRead>;   // by display name
  rel: Record<string, Relation>;      // by "fromName>toName"
};

const MAX_EVENTS = 24;
const MAX_RELATIONS = 30;

export function emptyTableMemory(): TableMemory {
  return { v: 1, hands: 0, events: [], emo: {}, human: {}, rel: {} };
}

export function normalizeTableMemory(raw: unknown): TableMemory {
  const m = (raw && typeof raw === "object" ? raw : {}) as Partial<TableMemory>;
  return {
    v: 1,
    hands: Number(m.hands || 0),
    events: Array.isArray(m.events) ? m.events.slice(-MAX_EVENTS) : [],
    emo: m.emo && typeof m.emo === "object" ? m.emo as Record<string, CharEmotion> : {},
    human: m.human && typeof m.human === "object" ? m.human as Record<string, HumanRead> : {},
    rel: m.rel && typeof m.rel === "object" ? m.rel as Record<string, Relation> : {},
  };
}

function bumpRelation(mem: TableMemory, from: string, to: string, delta: number, why: string, hand: number) {
  if (!from || !to || from === to) return;
  const key = `${from}>${to}`;
  const cur = mem.rel[key] || { score: 0, why: "", hand: 0 };
  cur.score = Math.max(-3, Math.min(3, cur.score + delta));
  cur.why = why;
  cur.hand = hand;
  mem.rel[key] = cur;
  // Keep the map bounded: drop the stalest near-neutral entries first.
  const keys = Object.keys(mem.rel);
  if (keys.length > MAX_RELATIONS) {
    keys
      .sort((a, b) => (Math.abs(mem.rel[a].score) - Math.abs(mem.rel[b].score)) || (mem.rel[a].hand - mem.rel[b].hand))
      .slice(0, keys.length - MAX_RELATIONS)
      .forEach((k) => delete mem.rel[k]);
  }
}

// deno-lint-ignore no-explicit-any
export async function loadTableMemory(client: any, tableId: string): Promise<TableMemory> {
  try {
    const { data } = await client
      .from("online_tables")
      .select("banter_memory")
      .eq("id", tableId)
      .maybeSingle();
    return normalizeTableMemory(data?.banter_memory);
  } catch {
    return emptyTableMemory();
  }
}

// deno-lint-ignore no-explicit-any
export async function saveTableMemory(client: any, tableId: string, mem: TableMemory): Promise<void> {
  try {
    mem.events = mem.events.slice(-MAX_EVENTS);
    await client.from("online_tables").update({ banter_memory: mem }).eq("id", tableId);
  } catch {
    // memory is flavor -- never let it break the runtime
  }
}

// ---------------------------------------------------------------------------
// Settle classification: turn a finished hand into memories + an "aftermath"
// descriptor the settle banter uses so reactions match what ACTUALLY happened
// (bluff shown vs cooler vs steal), not a generic win/lose line.
// ---------------------------------------------------------------------------

export type SettlePlayer = {
  name: string;
  characterId: string | null;  // null for humans
  isBot: boolean;
  folded: boolean;
  netBb: number;               // (result_amount - committed) / bb
  committedBb: number;
  holeCards: string[];
  wasAggressor: boolean;       // made the last bet/raise of the hand
};

export type Aftermath = {
  kind: "bluff_called" | "hero_call" | "cooler" | "big_showdown" | "steal" | "plain";
  potBb: number;
  showdown: boolean;
  winnerName: string | null;
  winnerLabel: string | null;  // e.g. "Two Pair (K)"
  loserName: string | null;
  loserLabel: string | null;
  caughtName: string | null;   // who got caught bluffing, if anyone
};

export function classifySettle({
  players, boardCards, potBb, handNo,
}: {
  players: SettlePlayer[];
  boardCards: string[];
  potBb: number;
  handNo: number;
}): { events: MemEvent[]; aftermath: Aftermath } {
  const events: MemEvent[] = [];
  const unfolded = players.filter((p) => !p.folded);
  const showdown = unfolded.length >= 2;
  const byNet = players.slice().sort((a, b) => b.netBb - a.netBb);
  const winner = byNet[0] && byNet[0].netBb > 0 ? byNet[0] : null;
  const loser = byNet[byNet.length - 1] && byNet[byNet.length - 1].netBb < 0
    ? byNet[byNet.length - 1] : null;
  const pot = Math.round(potBb);

  const describe = (p: SettlePlayer) => {
    if (!showdown || boardCards.length < 5 || !Array.isArray(p.holeCards) || p.holeCards.length < 2) return null;
    try {
      const d = describeSevenCardHand([...p.holeCards, ...boardCards], p.holeCards);
      return d && d.classRank != null ? d : null;
    } catch { return null; }
  };

  const winnerDesc = winner && !winner.folded ? describe(winner) : null;
  const aftermath: Aftermath = {
    kind: "plain",
    potBb,
    showdown,
    winnerName: winner?.name || null,
    winnerLabel: winnerDesc?.label || null,
    loserName: loser?.name || null,
    loserLabel: null,
    caughtName: null,
  };

  if (showdown) {
    const aggressor = unfolded.find((p) => p.wasAggressor && p.netBb < 0) || null;
    const aggrDesc = aggressor ? describe(aggressor) : null;
    const loserAtShowdown = unfolded.filter((p) => p.netBb < 0).sort((a, b) => a.netBb - b.netBb)[0] || null;
    const loserDesc = loserAtShowdown ? describe(loserAtShowdown) : null;
    if (loserAtShowdown && loserDesc) aftermath.loserName = loserAtShowdown.name;
    aftermath.loserLabel = loserDesc?.label || null;

    // Caught bluffing: the hand's last aggressor tabled junk and lost.
    if (aggressor && aggrDesc && aggrDesc.classRank <= 1 && potBb >= 6) {
      aftermath.caughtName = aggressor.name;
      if (winner && winnerDesc && winnerDesc.classRank <= 1) {
        aftermath.kind = "hero_call";
        events.push({
          t: "hero_call", hand: handNo, w: 3,
          note: `${winner.name} hero-called ${aggressor.name} with just ${winnerDesc.label} -- and was right`,
        });
      } else {
        aftermath.kind = "bluff_called";
        events.push({
          t: "bluff_called", hand: handNo, w: 3,
          note: `${aggressor.name} got caught bluffing a ${pot}bb pot -- the table saw everything`,
        });
      }
    } else if (loserAtShowdown && loserDesc && loserDesc.classRank >= 2 && loserAtShowdown.netBb <= -12) {
      // Lost big WITH a real hand: cooler / bad beat territory.
      aftermath.kind = "cooler";
      events.push({
        t: "cooler", hand: handNo, w: 3,
        note: `${loserAtShowdown.name} lost a ${pot}bb pot holding ${loserDesc.label} -- brutal beat`,
      });
    } else if (potBb >= 24 && winner) {
      aftermath.kind = "big_showdown";
      events.push({
        t: "big_pot", hand: handNo, w: 2,
        note: `${winner.name} dragged a ${pot}bb pot${winnerDesc ? ` with ${winnerDesc.label}` : ""}`,
      });
    }
  } else if (winner && potBb >= 10) {
    aftermath.kind = "steal";
    events.push({
      t: "steal", hand: handNo, w: 1.5,
      note: `${winner.name} bet everyone off a ${pot}bb pot -- nobody paid to see it`,
    });
  }

  // Big stack swings that no richer event already covered.
  if (!events.length && loser && loser.netBb <= -15) {
    events.push({
      t: "big_loss", hand: handNo, w: 1.5,
      note: `${loser.name} is stuck after dumping a ${pot}bb pot`,
    });
  }

  return { events, aftermath };
}

// ---------------------------------------------------------------------------
// Directional relationship drift, driven by what the table just watched.
// A shown bluff plants revenge in the bluffer and disbelief in the caller; a
// cooler leaves the loser convinced the winner is a luckbox; a hero call earns
// respect from everyone who saw it.
// ---------------------------------------------------------------------------
export function updateRelationships(mem: TableMemory, players: SettlePlayer[], aftermath: Aftermath, handNo: number) {
  const names = players.map((p) => p.name);
  if (aftermath.kind === "bluff_called" || aftermath.kind === "hero_call") {
    const bluffer = aftermath.caughtName;
    const caller = aftermath.winnerName;
    if (bluffer && caller) {
      bumpRelation(mem, bluffer, caller, -2, `${caller} looked up your bluff and showed the table (hand ${handNo}) -- you want that back`, handNo);
      bumpRelation(mem, caller, bluffer, -1, `you caught ${bluffer} bluffing (hand ${handNo}) -- you don't believe a word now`, handNo);
      if (aftermath.kind === "hero_call") {
        for (const n of names) {
          if (n !== caller && n !== bluffer) {
            bumpRelation(mem, n, caller, 1, `${caller}'s hero call (hand ${handNo}) earned real respect`, handNo);
          }
        }
      }
    }
  } else if (aftermath.kind === "cooler" && aftermath.loserName && aftermath.winnerName) {
    bumpRelation(mem, aftermath.loserName, aftermath.winnerName, -1, `${aftermath.winnerName} got there on you in a huge pot (hand ${handNo}) -- pure luck, obviously`, handNo);
  } else if (aftermath.kind === "steal" && aftermath.winnerName && aftermath.potBb >= 14) {
    for (const p of players) {
      if (p.name !== aftermath.winnerName && p.folded && p.committedBb >= 4) {
        bumpRelation(mem, p.name, aftermath.winnerName, -1, `${aftermath.winnerName} bet you off a big pot with no showdown (hand ${handNo}) -- it still itches`, handNo);
      }
    }
  }
}

// The speaker's strongest active feelings about specific people -- fed into
// their prompts so grudges and respect shape tone and target choice.
export function relationLinesFor(mem: TableMemory, speakerName: string, max = 2): string[] {
  const lines: { line: string; strength: number; hand: number }[] = [];
  for (const [key, r] of Object.entries(mem.rel)) {
    const [from, to] = key.split(">");
    if (from !== speakerName || !to || Math.abs(r.score) < 1) continue;
    const feel = r.score <= -2 ? `You have a live GRUDGE against ${to}`
      : r.score < 0 ? `You're salty at ${to}`
      : r.score >= 2 ? `You genuinely respect ${to}`
      : `You've warmed to ${to}`;
    lines.push({ line: `${feel}: ${r.why}.`, strength: Math.abs(r.score), hand: r.hand });
  }
  return lines
    .sort((a, b) => (b.strength - a.strength) || (b.hand - a.hand))
    .slice(0, max)
    .map((l) => l.line);
}

// Strongest grudge score `speakerName` holds against anyone in `names` --
// used to hand the mic to whoever has unfinished business.
export function grudgeWeight(mem: TableMemory, speakerName: string, names: string[]): number {
  let strongest = 0;
  for (const n of names) {
    const r = mem.rel[`${speakerName}>${n}`];
    if (r && r.score < strongest) strongest = r.score;
  }
  return Math.abs(strongest); // 0..3
}

// ---------------------------------------------------------------------------
// Emotional drift. Gradual: intensity walks up on losses/embarrassments and
// bleeds off on wins or quiet hands. Tilt needs a run of pain, not one pot.
// ---------------------------------------------------------------------------
export function updateEmotions(mem: TableMemory, players: SettlePlayer[], aftermath: Aftermath, handNo: number) {
  for (const p of players) {
    if (!p.isBot || !p.characterId) continue;
    const e: CharEmotion = mem.emo[p.characterId] || { n: p.name, s: "neutral", i: 0, streak: 0, hand: 0 };
    e.n = p.name;
    const caught = aftermath.caughtName === p.name;
    const coolered = aftermath.kind === "cooler" && aftermath.loserName === p.name;

    if (p.netBb <= -10 || caught) {
      e.streak = Math.min(0, e.streak) - 1;
      e.i = Math.min(3, e.i + (caught || coolered ? 2 : 1));
      e.hand = handNo;
    } else if (p.netBb >= 10) {
      e.streak = Math.max(0, e.streak) + 1;
      e.i = Math.max(0, e.i - 2);
      e.hand = handNo;
    } else if (e.i > 0 && handNo - e.hand >= 2) {
      e.i -= 1; // quiet hands cool everyone down
      e.hand = handNo;
    }

    e.s = e.i >= 3 || e.streak <= -3 ? "tilted"
      : e.i >= 2 ? "frustrated"
      : e.streak >= 2 ? "confident"
      : "neutral";
    mem.emo[p.characterId] = e;
  }
}

// Human reads, updated once per settle from the finished hand.
export function updateHumanReads(mem: TableMemory, players: SettlePlayer[], showdown: boolean) {
  for (const p of players) {
    if (p.isBot) continue;
    const h: HumanRead = mem.human[p.name] || { hands: 0, vpip: 0, pfFoldStreak: 0, sdWon: 0, sdLost: 0, tanks: 0 };
    h.hands += 1;
    // Voluntarily played: put in more than a forced blind, or saw it through.
    const played = p.committedBb > 1.05 || !p.folded;
    if (played) { h.vpip += 1; h.pfFoldStreak = 0; }
    else h.pfFoldStreak += 1;
    if (showdown && !p.folded) {
      if (p.netBb > 0) h.sdWon += 1; else h.sdLost += 1;
    }
    mem.human[p.name] = h;
  }
}

export function noteHumanTank(mem: TableMemory, name: string) {
  const h: HumanRead = mem.human[name] || { hands: 0, vpip: 0, pfFoldStreak: 0, sdWon: 0, sdLost: 0, tanks: 0 };
  h.tanks += 1;
  mem.human[name] = h;
}

// ---------------------------------------------------------------------------
// Prompt rendering: the shared TABLE MEMORY block (history everyone knows) and
// the per-speaker mind line (their own current emotional state).
// ---------------------------------------------------------------------------
export function memoryPromptBlock(
  mem: TableMemory,
  { speakerCharacterId, speakerName }: { speakerCharacterId?: string | null; speakerName?: string | null } = {},
): string | null {
  const lines: string[] = [];

  // Sharpest recent memories first; fresher wins ties. Dedupe near-identical
  // notes (routine repeats like "X dragged a 25bb pot" would read as a stutter).
  const seenNotes = new Set<string>();
  const picked = mem.events
    .slice()
    .sort((a, b) => (b.w - a.w) || (b.hand - a.hand))
    .filter((ev) => {
      const key = ev.note.replace(/\d+/g, "#");
      if (seenNotes.has(key)) return false;
      seenNotes.add(key);
      return true;
    })
    .slice(0, 4)
    .sort((a, b) => a.hand - b.hand);
  for (const ev of picked) lines.push(`- ${ev.note} (hand ${ev.hand})`);

  // Reads on the humans, when they've earned one.
  for (const [name, h] of Object.entries(mem.human)) {
    if (h.pfFoldStreak >= 5) lines.push(`- ${name} has folded ${h.pfFoldStreak} hands in a row`);
    else if (h.hands >= 8 && h.vpip / h.hands >= 0.7) lines.push(`- ${name} plays nearly every pot`);
    if (h.tanks >= 2) lines.push(`- ${name} keeps going deep in the tank on decisions`);
    if (h.sdWon >= 3 && h.sdLost === 0) lines.push(`- ${name} has shown up with the goods every single showdown`);
  }

  // Everyone can see who's steaming (except your own state -- that's `mind`).
  for (const [cid, e] of Object.entries(mem.emo)) {
    if (cid === speakerCharacterId) continue;
    if (e.s === "tilted") lines.push(`- ${e.n} is visibly tilted -- ${Math.abs(e.streak)} big pots lost in a row`);
  }

  // The speaker's own unfinished business -- grudges and respect steer tone.
  if (speakerName) {
    for (const rl of relationLinesFor(mem, speakerName)) lines.push(`- ${rl}`);
  }

  if (!lines.length) return null;
  return [
    "TABLE MEMORY -- real history from this session. Interpret it through YOUR character's eyes (a bully reads folding as fear; a vet reads it as patience). Callback fuel: weave one in naturally when it fits -- running jokes get better the second time, but retire a joke once it's had its payoff. Never recite the list, never invent history that isn't here:",
    ...lines.slice(0, 7),
  ].join("\n");
}

// The speaker's own emotional state, phrased as direction for the line.
export function mindLineFor(mem: TableMemory, characterId: string | null | undefined): string | null {
  if (!characterId) return null;
  const e = mem.emo[characterId];
  if (!e) return null;
  if (e.s === "tilted") return `YOUR STATE: you are TILTED -- ${Math.abs(e.streak)} big pots lost and it shows. Shorter fuse, darker lines, no patience for jokes at your expense.`;
  if (e.s === "frustrated") return "YOUR STATE: you're stuck and irritated tonight -- drier and snippier than usual, less generous with laughs.";
  if (e.s === "confident") return "YOUR STATE: you're running hot and feel bulletproof -- expansive, cocky, quicker to needle everyone else.";
  return null;
}
