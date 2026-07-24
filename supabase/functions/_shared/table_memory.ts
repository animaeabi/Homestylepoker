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
  who?: string;   // the player the moment is ABOUT (joke ownership)
};

export type CharEmotion = {
  n: string;          // display name (for cross-character prompt lines)
  s: "neutral" | "confident" | "frustrated" | "tilted";
  i: number;          // intensity 0..3
  streak: number;     // +wins / -losses in big pots, consecutive
  hand: number;       // last hand that moved this state
  moment?: string | null; // transient flash from the LAST settle (embarrassed/vindicated/...)
  story?: string | null;  // self-narrative: what they believe tonight says about them
};

export type HumanRead = {
  hands: number;
  vpip: number;          // hands they voluntarily played
  pfFoldStreak: number;  // consecutive hands folded without playing
  sdWon: number;
  sdLost: number;
  tanks: number;
  rebuys?: number;       // reloads this session (pride has a ledger)
  jams?: number;         // big preflop open-shoves (>= ~18bb committed as aggressor)
  jamStreak?: number;    // consecutive hands doing it -- the hostage-taking meter
  labels?: string[];     // engine-profile reads (nit/lag/station/trapper/...)
};

// How the engine's opponent-profile tags read as SOCIAL reputations. The
// characters get the observation; their persona supplies the interpretation
// (a bully reads "nit" as fear, a vet reads it as patience).
const LABEL_PHRASES: Record<string, string> = {
  nit: "plays scared-tight -- barely enters a pot",
  tag: "plays solid, disciplined poker",
  lag: "is in everything and always betting",
  station: "is a calling station -- nearly impossible to bluff",
  trapper: "is a trapper -- when they go quiet, danger",
  "bluff-heavy": "bluffs far too much",
  "river-overfolder": "folds rivers under pressure -- one big bet gets it done",
  tilting: "is visibly tilting",
  protecting_stack: "has started protecting a short stack",
  bullying: "is bullying the table with a big stack",
  sticky_after_showdown: "goes sticky after losing a showdown -- won't fold for an orbit",
};

export function setHumanLabels(mem: TableMemory, name: string, labels: string[]) {
  const h: HumanRead = mem.human[name] || { hands: 0, vpip: 0, pfFoldStreak: 0, sdWon: 0, sdLost: 0, tanks: 0 };
  h.labels = labels.filter((l) => LABEL_PHRASES[l]).slice(0, 3);
  mem.human[name] = h;
}

// Directional relationship: how `from` (a display name) currently feels about
// `to`. Directional on purpose -- Pony can respect Finn while Finn just finds
// Pony exhausting. score runs -3 (open grudge) .. +3 (real respect) and drives
// speaker selection; `kind` is the QUALITY of the feeling (revenge is not
// fear is not amusement), and `why` is the last event that moved it.
export type Relation = { score: number; why: string; hand: number; kind?: string | null };

// How each relationship kind reads in a speaker's head. Sentiment (score) says
// how strongly; kind says what it actually IS.
const KIND_FEEL: Record<string, string> = {
  revenge: "You want REVENGE on {to}",
  suspicious: "You don't believe a word out of {to} anymore",
  respectful: "You genuinely respect {to}",
  resentful: "You resent {to}",
  irritated: "{to} irritates you",
  amused: "{to} genuinely amuses you",
  exhausted: "{to} exhausts you",
  protective: "You feel oddly protective of {to}",
  intimidated: "{to} unsettles you -- you can't get a grip on them",
  competitive: "You and {to} are locked in a contest for this room",
  curious: "You can't stop studying {to}",
};

export type TableMemory = {
  v: number;
  hands: number;
  events: MemEvent[];
  emo: Record<string, CharEmotion>;   // by characterId
  human: Record<string, HumanRead>;   // by display name
  rel: Record<string, Relation>;      // by "fromName>toName"
  seeded?: string[];                  // characterIds whose chemistry is planted
  lastNeedle?: { target: string; at: number } | null; // repetition guard: who just got heat
  hush?: { until: number; kind: string; note: string } | null; // designed table silence
  lastMoment?: { at: number; pr: number } | null; // director gate: last line's priority
  joke?: { note: string; owner: string; hand: number; uses: number; retired: boolean } | null; // active running joke
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
    seeded: Array.isArray(m.seeded) ? m.seeded : [],
    lastNeedle: m.lastNeedle && typeof m.lastNeedle === "object" ? m.lastNeedle : null,
    hush: m.hush && typeof m.hush === "object" ? m.hush : null,
    lastMoment: m.lastMoment && typeof m.lastMoment === "object" ? m.lastMoment : null,
    joke: m.joke && typeof m.joke === "object" ? m.joke : null,
  };
}

// ---------------------------------------------------------------------------
// Running-joke lifecycle: creation -> evolution -> retirement, as STATE rather
// than a prompt suggestion. A table-legend event (w >= 3) becomes the active
// joke; it stays callback fuel for a handful of hands (each retelling should
// escalate), then retires before it wears out. A newer legend supersedes an
// aging one. Retired jokes vanish from prompts -- a joke that had its payoff
// stays dead unless a genuinely new legend takes its place.
// ---------------------------------------------------------------------------
export function advanceRunningJoke(mem: TableMemory, freshEvents: MemEvent[], handNo: number) {
  if (mem.joke && !mem.joke.retired) {
    mem.joke.uses += 1;
    if (mem.joke.uses >= 6) mem.joke.retired = true; // had its run; let it rest
  }
  const candidate = (freshEvents || []).find((e) => e.w >= 3);
  if (candidate && (!mem.joke || mem.joke.retired || handNo - mem.joke.hand >= 3)) {
    mem.joke = { note: candidate.note, owner: candidate.who || "the table", hand: handNo, uses: 0, retired: false };
  }
}

// ---------------------------------------------------------------------------
// Designed silence: some moments deserve a hush, not a quip. The aftermath can
// declare one -- the table then sits with it (ambient talk suppressed, no
// settle line), and whoever eventually speaks knows they are BREAKING it.
// ---------------------------------------------------------------------------
export function maybeStartHush(mem: TableMemory, aftermath: Aftermath): { kind: string; note: string } | null {
  let kind: string | null = null;
  let p = 0;
  if (aftermath.kind === "hero_call") { kind = "respectful"; p = 0.35; }
  else if (aftermath.kind === "bluff_called") { kind = "embarrassed"; p = 0.3; }
  else if (aftermath.kind === "cooler" && aftermath.potBb >= 25) { kind = "stunned"; p = 0.35; }
  if (!kind || Math.random() >= p) return null;
  const note =
    aftermath.kind === "hero_call" ? `${aftermath.winnerName}'s hero call on ${aftermath.caughtName}`
    : aftermath.kind === "bluff_called" ? `${aftermath.caughtName}'s bluff getting shown`
    : `the brutal cooler that just hit ${aftermath.loserName}`;
  mem.hush = { until: Date.now() + 15000, kind, note };
  return { kind, note };
}

export function hushActive(mem: TableMemory): boolean {
  return Boolean(mem.hush && Date.now() < Number(mem.hush.until || 0));
}

// Prompt direction for the first voice after (or during) a designed silence.
// Stays relevant for a short window after the hush lifts.
export function hushLine(mem: TableMemory): string | null {
  if (!mem.hush) return null;
  const age = Date.now() - Number(mem.hush.until || 0);
  if (age > 45000) return null;
  return `THE ROOM: the table just sat in ${mem.hush.kind} silence after ${mem.hush.note}. If you speak now, YOU are the one breaking that silence -- acknowledge the weight, or puncture it deliberately. Either way, the pause happened.`;
}

// ---------------------------------------------------------------------------
// Conversation director (global gate): several systems can want to talk at
// once. A clearly weaker line must not stomp a strong moment that just
// happened -- an ambient crack two seconds after a shown bluff kills the beat.
// Priorities: 1 reply-to-human, 2 settle aftermath, 3 in-hand pressure /
// aftermath chorus, 4 session events, 5 ambient, 6 stray nonverbals. A line
// two or more rungs weaker than the last moment yields for a few seconds;
// direct chains (one rung apart) are part of the moment and flow through.
// ---------------------------------------------------------------------------
export function stepsOnMoment(mem: TableMemory, priority: number, windowMs = 8000): boolean {
  if (!mem.lastMoment) return false;
  return priority - Number(mem.lastMoment.pr || 5) >= 2
    && Date.now() - Number(mem.lastMoment.at || 0) < windowMs;
}

export function noteMoment(mem: TableMemory, priority: number) {
  mem.lastMoment = { at: Date.now(), pr: priority };
}

// ---------------------------------------------------------------------------
// Session dramatic arc: hand count sets the social register so hand 3 and
// hand 30 don't carry the same maturity. Pacing direction, not a script.
// ---------------------------------------------------------------------------
export function sessionArcLine(mem: TableMemory): string {
  const h = mem.hands;
  if (h < 4) return "SESSION ARC: the night is just starting -- exploratory energy. Feel people out; reads and jokes are still forming. Do NOT open at full hostility.";
  if (h < 10) return "SESSION ARC: settling in -- styles are showing, small jokes and minor irritations are taking root. Rivalries forming, not yet declared.";
  if (h < 20) return "SESSION ARC: deep in the session -- the money and the history are real now. Grudges have names, needles are personal, callbacks land hardest here.";
  return "SESSION ARC: late session -- everyone's tired, the history is long, unsettled scores itch. Fewer jokes, heavier callbacks; what's unfinished wants finishing.";
}

// Target-recency guard: the same player shouldn't take heat from the table
// twice in quick succession (real pressure comes in waves, not a drone).
// Returns true when this target just got needled and should usually be spared.
export function needledTooRecently(mem: TableMemory, targetName: string, windowMs = 100000): boolean {
  return Boolean(
    mem.lastNeedle
    && mem.lastNeedle.target === targetName
    && Date.now() - Number(mem.lastNeedle.at || 0) < windowMs,
  );
}

export function noteNeedle(mem: TableMemory, targetName: string) {
  mem.lastNeedle = { target: targetName, at: Date.now() };
}

// ---------------------------------------------------------------------------
// Chemistry: the roster arrives already knowing each other. These seeds plant
// the starting biases from the pairing map -- noise vs silence, eruption vs
// composure, theory vs chaos, scarcity vs abundance -- as mild (+/-1) leanings
// that real session events then confirm, invert, or bury. Directional on
// purpose; earned feelings are never overwritten.
// ---------------------------------------------------------------------------
const CHEMISTRY: Array<{ from: string; to: string; score: number; why: string; kind?: string }> = [
  // Pony vs Finn: noise against silence.
  { from: "pony", to: "eyev", score: -1, kind: "irritated", why: "his silence gives you NOTHING to push against -- no reaction, no respect, and it eats at you" },
  { from: "eyev", to: "pony", score: -1, kind: "exhausted", why: "he is noise. Endless noise. You answer him in four words or none" },
  // Fill vs Sydell: eruption against composure.
  { from: "hellsmouth", to: "sydell", score: -1, kind: "irritated", why: "his calm feels like a quiet judgment of every one of your eruptions" },
  { from: "sydell", to: "hellsmouth", score: 1, kind: "amused", why: "you've watched brats melt down for forty years -- his tantrums are almost nostalgic" },
  // Haxxon vs Donk: theory against chaos.
  { from: "haxxon", to: "donk", score: -1, kind: "intimidated", why: "his chaos breaks your models and he doesn't even notice he's doing it" },
  { from: "donk", to: "haxxon", score: 1, kind: "amused", why: "the math guy keeps trying to solve you. it's sort of funny" },
  // Grease vs Holes: scarcity against abundance.
  { from: "grease", to: "holes", score: -1, kind: "irritated", why: "he burns money like incense and calls it growth -- it offends your ledger personally" },
  { from: "holes", to: "grease", score: 1, kind: "curious", why: "his scarcity mindset is a beautiful case study -- you'd love to coach him. For a fee" },
  // Dandy vs Finn: constant interpretation against unreadability.
  { from: "negranope", to: "eyev", score: -1, kind: "curious", why: "he's the ONE player at this table you cannot read, and it itches" },
  { from: "eyev", to: "negranope", score: -1, kind: "irritated", why: "he narrates reads all night. Noise pretending to be signal" },
  // Hunger vs Grease: speed against caution.
  { from: "hunger", to: "grease", score: -1, kind: "exhausted", why: "he takes a full minute to fold and it is stealing your LIFE" },
  { from: "grease", to: "hunger", score: -1, kind: "suspicious", why: "that pace is how mistakes happen. You wrote it down, with the date" },
  // Pony vs Fill: two players competing to control the room.
  { from: "pony", to: "hellsmouth", score: -1, kind: "competitive", why: "two loud kings, one room -- and he keeps grabbing YOUR spotlight" },
  { from: "hellsmouth", to: "pony", score: -1, kind: "competitive", why: "he yells like he's earned it. NINETEEN titles say otherwise" },
  // Sydell vs Hunger: patience against impatience.
  { from: "sydell", to: "hunger", score: 1, kind: "protective", why: "the kid's fearless -- reminds you of somebody, about forty years ago" },
  { from: "hunger", to: "sydell", score: -1, kind: "irritated", why: "he plays at the speed limit and the whole table treats it like wisdom" },
];

// Plant chemistry for any newly seated characters (idempotent, late-join safe).
// Returns true if the memory changed and should be saved.
export function seedChemistry(mem: TableMemory, bots: { characterId: string; name: string }[]): boolean {
  const seeded = new Set(mem.seeded || []);
  const nameByChar = new Map(bots.map((b) => [b.characterId, b.name]));
  let changed = false;
  for (const c of CHEMISTRY) {
    const fromName = nameByChar.get(c.from);
    const toName = nameByChar.get(c.to);
    if (!fromName || !toName) continue;
    if (seeded.has(c.from) && seeded.has(c.to)) continue; // pair already planted
    const key = `${fromName}>${toName}`;
    if (mem.rel[key]) continue; // never stomp feelings the session has earned
    mem.rel[key] = { score: c.score, why: c.why, hand: 0, kind: c.kind || null };
    changed = true;
  }
  for (const b of bots) {
    if (!seeded.has(b.characterId)) { seeded.add(b.characterId); changed = true; }
  }
  mem.seeded = [...seeded];
  return changed;
}

function bumpRelation(mem: TableMemory, from: string, to: string, delta: number, why: string, hand: number, kind?: string | null) {
  if (!from || !to || from === to) return;
  const key = `${from}>${to}`;
  const cur = mem.rel[key] || { score: 0, why: "", hand: 0 };
  cur.score = Math.max(-3, Math.min(3, cur.score + delta));
  cur.why = why;
  cur.hand = hand;
  if (kind) cur.kind = kind; // fresh events re-type the feeling
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
  // Memory notes feed straight into speech prompts, so they talk like people
  // ("a huge pot"), never like a hand history ("43bb pot").
  const pot = potBb >= 120 ? "a monster pot" : potBb >= 60 ? "a huge pot" : potBb >= 25 ? "a big pot" : potBb >= 10 ? "a decent pot" : "a small pot";

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
          t: "hero_call", hand: handNo, w: 3, who: winner.name,
          note: `${winner.name} hero-called ${aggressor.name} with just ${winnerDesc.label} -- and was right`,
        });
      } else {
        aftermath.kind = "bluff_called";
        events.push({
          t: "bluff_called", hand: handNo, w: 3, who: aggressor.name,
          note: `${aggressor.name} got caught bluffing ${pot} -- the table saw everything`,
        });
      }
    } else if (loserAtShowdown && loserDesc && loserDesc.classRank >= 2 && loserAtShowdown.netBb <= -12) {
      // Lost big WITH a real hand: cooler / bad beat territory.
      aftermath.kind = "cooler";
      events.push({
        t: "cooler", hand: handNo, w: 3, who: loserAtShowdown.name,
        note: `${loserAtShowdown.name} lost ${pot} holding ${loserDesc.label} -- brutal beat`,
      });
    } else if (potBb >= 24 && winner) {
      aftermath.kind = "big_showdown";
      events.push({
        t: "big_pot", hand: handNo, w: 2, who: winner.name,
        note: `${winner.name} dragged ${pot}${winnerDesc ? ` with ${winnerDesc.label}` : ""}`,
      });
    }
  } else if (winner && potBb >= 10) {
    aftermath.kind = "steal";
    events.push({
      t: "steal", hand: handNo, w: 1.5, who: winner.name,
      note: `${winner.name} bet everyone off ${pot} -- nobody paid to see it`,
    });
  }

  // Big stack swings that no richer event already covered.
  if (!events.length && loser && loser.netBb <= -15) {
    events.push({
      t: "big_loss", hand: handNo, w: 1.5,
      note: `${loser.name} is stuck after dumping ${pot}`,
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
      bumpRelation(mem, bluffer, caller, -2, `${caller} looked up your bluff and showed the table (hand ${handNo}) -- you want that back`, handNo, "revenge");
      bumpRelation(mem, caller, bluffer, -1, `you caught ${bluffer} bluffing (hand ${handNo}) -- you don't believe a word now`, handNo, "suspicious");
      if (aftermath.kind === "hero_call") {
        for (const n of names) {
          if (n !== caller && n !== bluffer) {
            bumpRelation(mem, n, caller, 1, `${caller}'s hero call (hand ${handNo}) earned real respect`, handNo, "respectful");
          }
        }
      }
    }
  } else if (aftermath.kind === "cooler" && aftermath.loserName && aftermath.winnerName) {
    bumpRelation(mem, aftermath.loserName, aftermath.winnerName, -1, `${aftermath.winnerName} got there on you in a huge pot (hand ${handNo}) -- pure luck, obviously`, handNo, "resentful");
  } else if (aftermath.kind === "steal" && aftermath.winnerName && aftermath.potBb >= 14) {
    for (const p of players) {
      if (p.name !== aftermath.winnerName && p.folded && p.committedBb >= 4) {
        bumpRelation(mem, p.name, aftermath.winnerName, -1, `${aftermath.winnerName} bet you off a big pot with no showdown (hand ${handNo}) -- it still itches`, handNo, "irritated");
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
    // The kind names WHAT the feeling is; the score only says how strongly.
    // An intense grudge still overrides a mild typed feeling in the phrasing.
    const typed = r.kind && KIND_FEEL[r.kind] ? KIND_FEEL[r.kind].replaceAll("{to}", to) : null;
    const feel = r.score <= -2 && r.kind === "revenge" ? `You have a LIVE grudge against ${to} and you want it settled`
      : typed ? (Math.abs(r.score) >= 2 ? `${typed} -- intensely` : typed)
      : r.score <= -2 ? `You have a live GRUDGE against ${to}`
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
    const heroCalled = aftermath.kind === "hero_call" && aftermath.winnerName === p.name;
    const priorIntensity = e.i;

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

    // Moment emotion: a transient flash from THIS settle, sharper and shorter-
    // lived than the base state. It colors the very next reactions and then
    // gets recomputed at the next settle.
    e.moment = caught ? "embarrassed"
      : heroCalled ? "vindicated"
      : coolered ? "resentful"
      : (p.netBb >= 10 && priorIntensity >= 2) ? "relieved"
      : e.streak >= 4 ? "overconfident"
      : (e.s === "tilted" && p.netBb <= -10) ? "desperate"
      : null;

    // Self-narrative: the biased story they believe tonight is telling about
    // them. Wrong is allowed -- wrong is the point.
    e.story = e.s === "tilted" ? "The deck is against me tonight, and this whole table knows it."
      : caught ? "They're looking me up tonight. I've gotten readable, and that's a problem."
      : heroCalled ? "I am seeing EVERYTHING at this table tonight."
      : e.streak >= 3 ? "I own this table right now. They're starting to play scared against me."
      : e.streak <= -2 ? "I'm playing fine. I'm just not getting anything to work with."
      : null;

    mem.emo[p.characterId] = e;
  }
}

// Human reads, updated once per settle from the finished hand.
export function updateHumanReads(mem: TableMemory, players: SettlePlayer[], showdown: boolean, handNo = 0) {
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
    // Jam-spam meter: a big open-shove as the aggressor. One is a play;
    // a streak is hostage-taking -- the engine widens its calls off this
    // read, and the table starts saying so out loud.
    const jammed = p.wasAggressor && p.committedBb >= 18;
    if (jammed) {
      h.jams = Number(h.jams || 0) + 1;
      h.jamStreak = Number(h.jamStreak || 0) + 1;
      if (h.jamStreak === 3 || h.jamStreak === 6 || h.jamStreak === 9) {
        mem.events.push({
          t: "jam_spam", hand: handNo, w: 2.5, who: p.name,
          note: `${p.name} has open-shoved ${h.jamStreak} hands in a row -- holding the table hostage`,
        });
      }
    } else if (played) {
      h.jamStreak = 0; // a normal played hand breaks the pattern; folds don't
    }
    mem.human[p.name] = h;
  }
}

// A shown steal ("look what I had") is a targeted insult: everyone who folded
// takes it personally. Plants revenge in a witness.
export function noteRubIn(mem: TableMemory, shower: string, witness: string, handNo: number) {
  bumpRelation(mem, witness, shower, -1, `${shower} showed you the bluff after you folded (hand ${handNo}) -- rubbing it in`, handNo, "revenge");
}

// The engine's read on a specific opponent's shove habit (for call widening).
export function jammerReadFor(mem: TableMemory, name: string): { jams: number; jamStreak: number } | null {
  const h = mem.human[name];
  if (!h) return null;
  const jams = Number(h.jams || 0);
  const jamStreak = Number(h.jamStreak || 0);
  if (jams <= 0) return null;
  return { jams, jamStreak };
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
    // Engine-profile reputation: the table's professional read on their game.
    const phrased = (h.labels || []).map((l) => LABEL_PHRASES[l]).filter(Boolean);
    if (phrased.length) lines.push(`- ${name} ${phrased.join(", and ")}`);
    if (Number(h.jamStreak || 0) >= 3) lines.push(`- ${name} keeps open-shoving every hand (${h.jamStreak} straight) -- the table is being held hostage, everyone knows it, and patience is GONE`);
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

  if (mem.joke && !mem.joke.retired) {
    lines.push(`- RUNNING JOKE (the table's, born hand ${mem.joke.hand}, at ${mem.joke.owner}'s expense): ${mem.joke.note}. Callbacks to this are gold -- each retelling should ESCALATE or twist it, never repeat it flat.`);
  }
  const arc = sessionArcLine(mem);
  const hush = hushLine(mem);
  if (!lines.length) return [arc, ...(hush ? [hush] : [])].join("\n");
  return [
    "TABLE MEMORY -- real history from this session. Interpret it through YOUR character's eyes (a bully reads folding as fear; a vet reads it as patience). Callback fuel: weave one in naturally when it fits -- running jokes get better the second time, but retire a joke once it's had its payoff. Never recite the list, never invent history that isn't here:",
    ...lines.slice(0, 7),
    arc,
    ...(hush ? [hush] : []),
  ].join("\n");
}

// The transient moment-flash, phrased as delivery direction.
const MOMENT_LINES: Record<string, string> = {
  embarrassed: "RIGHT NOW: embarrassed -- your bluff was just shown to the whole table. Cover it however your character covers shame (deflect, sulk, laugh it off), but it's THERE.",
  vindicated: "RIGHT NOW: vindicated -- your read just paid off in front of everyone. Savor it in your own voice.",
  resentful: "RIGHT NOW: quietly furious about how that pot went -- it wasn't fair and you know it.",
  relieved: "RIGHT NOW: relieved -- you finally won one after taking a beating. The exhale shows.",
  overconfident: "RIGHT NOW: overconfident -- you feel untouchable, which is exactly when players get clipped. Swagger past the warning signs.",
  desperate: "RIGHT NOW: desperate -- stuck deep and starting to force it. The jokes are thinner, the stakes feel personal.",
};

// The speaker's own emotional state, phrased as direction for the line:
// base state + transient moment-flash + the self-narrative they believe.
export function mindLineFor(mem: TableMemory, characterId: string | null | undefined): string | null {
  if (!characterId) return null;
  const e = mem.emo[characterId];
  if (!e) return null;
  const parts: string[] = [];
  if (e.s === "tilted") parts.push(`YOUR STATE: you are TILTED -- ${Math.abs(e.streak)} big pots lost and it shows. Shorter fuse, darker lines, no patience for jokes at your expense.`);
  else if (e.s === "frustrated") parts.push("YOUR STATE: you're stuck and irritated tonight -- drier and snippier than usual, less generous with laughs.");
  else if (e.s === "confident") parts.push("YOUR STATE: you're running hot and feel bulletproof -- expansive, cocky, quicker to needle everyone else.");
  if (e.moment && MOMENT_LINES[e.moment]) parts.push(MOMENT_LINES[e.moment]);
  if (e.story) parts.push(`SELF-NARRATIVE (what you believe tonight says about you -- it may be wrong, but you believe it): "${e.story}"`);
  return parts.length ? parts.join("\n") : null;
}
