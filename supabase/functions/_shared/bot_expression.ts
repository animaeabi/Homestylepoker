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

    const expr = expressiveness(String(bot.personality));
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
