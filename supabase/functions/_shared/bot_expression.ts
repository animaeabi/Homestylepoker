// Server-driven bot "expression": occasional emoji reactions and card-shows at
// the end of a hand so the table feels alive instead of silent. Bots have no
// client, so the runtime tick emits these on their behalf. This module is the
// pure decision layer (what, if anything, each bot expresses); the runtime does
// the actual broadcast / DB writes.

export type BotPersonalityName = "TAG" | "LAG" | "Rock" | "Station";

export type BotSeatInfo = {
  seatNo: number;
  groupPlayerId: string;
  personality: BotPersonalityName | string;
  name?: string | null;
  expressiveness?: number; // per-character emote multiplier (overrides personality default)
};

export type SettledPlayer = {
  seatNo: number;
  groupPlayerId: string | null;
  folded: boolean;
  resultAmount: number; // net chips won/lost this hand
  committed: number;
  holeCards: string[];
  wasAggressor?: boolean; // made the last bet/raise/all-in this hand
};

export type BotReaction = { key: string; emoji: string; text: string };

export type BotExpression = {
  seatNo: number;
  groupPlayerId: string;
  name?: string | null;
  reaction?: BotReaction;
  showCards?: boolean;
};

// Palette mirrors the human quick-chat reactions so bots read as native, plus a
// few extra faces. The client renders whatever emoji/text it's handed.
const R: Record<string, BotReaction> = {
  clap: { key: "well_played", emoji: "\u{1F44F}", text: "Well played" },
  fire: { key: "nice_bluff", emoji: "\u{1F525}", text: "Nice bluff" },
  laugh: { key: "laugh", emoji: "\u{1F602}", text: "Laugh" },
  angry: { key: "angry", emoji: "\u{1F621}", text: "Angry" },
  smirk: { key: "ha_bluffed", emoji: "\u{1F60F}", text: "Ha!" },
  gg: { key: "good_game", emoji: "\u{1F91D}", text: "Good game" },
  ok: { key: "good_fold", emoji: "\u{1F44C}", text: "Good fold" },
  wow: { key: "wow", emoji: "\u{1F62E}", text: "Wow" },
  think: { key: "think", emoji: "\u{1F914}", text: "Hmm" },
  sweat: { key: "sweat", emoji: "\u{1F605}", text: "Phew" },
};

// How chatty each style is. LAG needles a lot, a Station is happy-go-lucky, a
// Rock barely emotes.
function expressiveness(personality: string) {
  switch (personality) {
    case "LAG": return 1.4;
    case "Station": return 1.25;
    case "Rock": return 0.5;
    case "TAG":
    default: return 1.0;
  }
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(p: number) {
  return Math.random() < p;
}

// Mid-hand table talk: after a bot commits a notable action, it may flash an
// in-character line (or a generic emoji) over its seat. Kept probabilistic and
// rare-ish so it feels alive, not spammy; expressiveness scales the chatter.
export function decideMidHandExpression({
  actionType,
  street,
  potBb,
  toCallBb,
  raiseToBb,
  personality,
  expressiveness: expressivenessOverride,
  taunts,
}: {
  actionType: string;
  street: string;
  potBb: number;
  toCallBb: number;
  raiseToBb?: number | null;
  personality: string;
  expressiveness?: number;
  taunts?: {
    aggro?: { emoji: string; text: string }[];
    call?: { emoji: string; text: string }[];
    fold?: { emoji: string; text: string }[];
  } | null;
}): BotReaction | null {
  const expr = typeof expressivenessOverride === "number"
    ? expressivenessOverride
    : expressiveness(String(personality));
  const bigPrice = Math.max(Number(toCallBb || 0), Number(raiseToBb || 0));
  const pickTaunt = (list?: { emoji: string; text: string }[]) =>
    (list && list.length ? list[Math.floor(Math.random() * list.length)] : null);

  let p = 0;
  let line: { emoji: string; text: string } | null = null;

  if (actionType === "all_in") {
    p = 0.5 * expr;
    line = pickTaunt(taunts?.aggro) || pick([R.fire, R.smirk]);
  } else if ((actionType === "bet" || actionType === "raise") && (bigPrice >= 6 || potBb >= 14)) {
    p = 0.24 * expr;
    line = pickTaunt(taunts?.aggro) || pick([R.smirk, R.fire]);
  } else if (actionType === "call" && (toCallBb >= 6 || potBb >= 16)) {
    p = 0.2 * expr;
    line = pickTaunt(taunts?.call) || pick([R.think, R.sweat, R.wow]);
  } else if (actionType === "fold" && toCallBb >= 6) {
    p = 0.12 * expr;
    line = pickTaunt(taunts?.fold) || pick([R.ok, R.think]);
  } else if ((actionType === "bet" || actionType === "raise") && street !== "preflop") {
    // Routine aggression: a whisper of table presence.
    p = 0.05 * expr;
    line = pickTaunt(taunts?.aggro) || pick([R.smirk, R.ok]);
  }

  if (!line || !chance(p)) return null;
  return { key: "table_talk", emoji: line.emoji, text: line.text };
}

// Decide what (if anything) each bot expresses when a hand settles. Returns at
// most a couple of expressions per hand so the table never spams.
export function decideBotExpressions({
  players,
  botSeats,
  potTotal,
  bigBlind,
}: {
  players: SettledPlayer[];
  botSeats: BotSeatInfo[];
  potTotal: number;
  bigBlind: number;
}): BotExpression[] {
  const botByGpid = new Map(botSeats.map((b) => [String(b.groupPlayerId), b]));
  const bb = Math.max(1, Number(bigBlind || 2));
  const potBb = Number(potTotal || 0) / bb;
  const liveAtEnd = players.filter((p) => !p.folded).length;
  const contestedShowdown = liveAtEnd >= 2;
  const bigPot = potBb >= 20;

  const out: BotExpression[] = [];

  for (const p of players) {
    if (!p.groupPlayerId) continue;
    const bot = botByGpid.get(String(p.groupPlayerId));
    if (!bot) continue;

    const expr = typeof bot.expressiveness === "number" ? bot.expressiveness : expressiveness(String(bot.personality));
    const net = Number(p.resultAmount || 0);
    const won = net > 0;
    const lostBig = net <= -(bb * 12);

    let reaction: BotReaction | null = null;
    let showCards = false;
    let reactP = 0.06 * expr;

    if (won && contestedShowdown) {
      // Won a showdown (cards already exposed) - a little chest-thump.
      reactP = 0.26 * expr;
      reaction = pick([R.clap, R.gg, R.smirk, R.laugh]);
    } else if (won && !contestedShowdown) {
      // Stole it uncontested. Occasionally flash the cards to needle the table -
      // a bluff reveal if they were the aggressor. LAG loves this; Rock doesn't.
      reactP = 0.22 * expr;
      reaction = pick([R.smirk, R.fire, R.ok]);
      if (p.wasAggressor && chance(0.14 * expr)) showCards = true;
    } else if (lostBig) {
      reactP = 0.28 * expr;
      reaction = pick([R.angry, R.laugh, R.wow, R.think]);
    } else if (bigPot) {
      reactP = 0.16 * expr;
      reaction = pick([R.wow, R.think, R.sweat]);
    } else {
      reactP = 0.05 * expr;
      reaction = pick([R.ok, R.gg]);
    }

    // Folded players occasionally flash the hand they let go once the pot is in
    // the books -- the classic live-poker "look what I folded" move. Rare and
    // flavor-only (never mid-hand; this runs at settle). Needs the cards to
    // actually be present in the settled state.
    if (!showCards && p.folded && Array.isArray(p.holeCards) && p.holeCards.length >= 2 && chance(0.06 * expr)) {
      showCards = true;
    }

    const doReact = reaction != null && chance(reactP);
    if (doReact || showCards) {
      out.push({
        seatNo: bot.seatNo,
        groupPlayerId: bot.groupPlayerId,
        name: bot.name ?? null,
        reaction: doReact ? reaction! : undefined,
        showCards: showCards || undefined,
      });
    }
  }

  // Cap the noise: at most two expressive bots per hand.
  return out.slice(0, 2);
}
