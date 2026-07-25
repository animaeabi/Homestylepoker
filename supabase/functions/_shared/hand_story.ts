// Hand Story: ONE canonical, factual account of a settled hand, built once at
// settle time and stored in table memory. Every speech path draws on it, so a
// character can never "not know" what just happened -- who did what street by
// street, what ended up face-up, what it made against the board, and what the
// pot really was. This replaces per-trigger fact-feeding (which left every
// unwired path improvising, and improvisation against visible facts reads as
// stupidity).

import { describeSevenCardHand } from "./showdown.ts";

export type StoryPlayerIn = {
  name: string;
  isBot: boolean;
  folded: boolean;
  holeCards: string[];      // raw tokens ("Ah") -- always known server-side
  manuallyShown?: boolean;
  netBb: number;            // result - committed, in bb
  committedBb: number;
};

export type HandStory = {
  handNo: number;
  text: string;                                        // the narration fed to prompts
  faceUp: { name: string; cards: string; made: string }[]; // public reveals only
  own: Record<string, string>;                         // botName -> "their own muck" line (private)
};

const RANK_WORDS: Record<string, string> = {
  A: "ace", K: "king", Q: "queen", J: "jack", T: "ten", "9": "nine", "8": "eight",
  "7": "seven", "6": "six", "5": "five", "4": "four", "3": "three", "2": "deuce",
};
const SUIT_WORDS: Record<string, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };

export function cardWord(c: string): string {
  const s = String(c || "").toUpperCase().replace("10", "T");
  const r = RANK_WORDS[s[0]] || s[0];
  const su = SUIT_WORDS[s[s.length - 1]] || "";
  return su ? `${r} of ${su}` : r;
}

function cardsPhrase(cards: string[]): string {
  return (cards || []).map(cardWord).join(" and ");
}

function madePhrase(holeCards: string[], board: string[]): string {
  try {
    if (!Array.isArray(holeCards) || holeCards.length < 2) return "";
    if (!Array.isArray(board) || board.length < 3) return "";
    const desc = describeSevenCardHand(holeCards.concat(board).map(String), holeCards.map(String));
    return desc?.label || "";
  } catch { return ""; }
}

function sizeFeel(amountBb: number): string {
  if (amountBb >= 60) return "a massive";
  if (amountBb >= 25) return "a huge";
  if (amountBb >= 10) return "a big";
  if (amountBb >= 4) return "a solid";
  return "a small";
}

// Compress the raw event stream into a short, human, street-tagged narration.
// Events: action_taken (payload.action_type/amount) segmented by street_dealt.
export function buildHandStory({
  handNo,
  bigBlind,
  boardCards,
  players,
  events,
  nameByGpid,
}: {
  handNo: number;
  bigBlind: number;
  boardCards: string[];
  players: StoryPlayerIn[];
  events: { event_type?: string; actor_group_player_id?: string | null; payload?: any }[];
  nameByGpid: Map<string, string>;
}): HandStory {
  const bb = Math.max(0.01, Number(bigBlind || 1));
  const board = (boardCards || []).map(String);
  const live = players.filter((p) => !p.folded);
  const uncontested = live.length <= 1;
  const winner = players.slice().sort((a, z) => z.netBb - a.netBb)[0] || null;
  // Honest pot via zero-sum: the money that actually moved is the losers'
  // total losses; the pot that was pushed is roughly twice that (their losses
  // plus the winner's matched share). Committed/result columns can't be
  // trusted here -- they include uncalled shoves refunded to the bettor.
  const awardedBb = 2 * players.reduce((sum, p) => sum + Math.max(0, -p.netBb), 0);

  // --- Action narration, street by street. -------------------------------
  const STREETS = ["preflop", "flop", "turn", "river"];
  let streetIdx = 0;
  const perStreet: string[][] = [[], [], [], []];
  for (const ev of events || []) {
    const type = String(ev?.event_type || "");
    if (type === "street_dealt") { streetIdx = Math.min(streetIdx + 1, 3); continue; }
    if (type !== "action_taken") continue;
    const act = String(ev?.payload?.action_type || "");
    if (!act) continue;
    const who = String(nameByGpid.get(String(ev?.actor_group_player_id || "")) || "someone");
    const amtBb = Number(ev?.payload?.amount || 0) / bb;
    const phrase = act === "fold" ? `${who} folded`
      : act === "check" ? `${who} checked`
      : act === "call" ? `${who} called`
      : act === "bet" ? `${who} bet ${sizeFeel(amtBb)} bet`
      : act === "raise" ? `${who} made ${sizeFeel(amtBb)} raise`
      : act === "all_in" ? `${who} shoved ALL IN${amtBb >= 25 ? ` (${sizeFeel(amtBb)} shove)` : ""}`
      : `${who} ${act}`;
    perStreet[streetIdx].push(phrase);
  }
  const actionText = STREETS
    .map((street, i) => (perStreet[i].length ? `${street}: ${perStreet[i].join(", ")}` : ""))
    .filter(Boolean)
    .join(". ");

  // --- Face-up facts (public) and own-muck lines (private per bot). -------
  const showdown = !uncontested && board.length >= 5;
  const faceUp: HandStory["faceUp"] = [];
  const own: Record<string, string> = {};
  for (const p of players) {
    if (!Array.isArray(p.holeCards) || p.holeCards.length < 2) continue;
    const isPublic = Boolean(p.manuallyShown) || (showdown && !p.folded);
    const made = madePhrase(p.holeCards, board);
    if (isPublic) {
      faceUp.push({ name: p.name, cards: cardsPhrase(p.holeCards), made });
    } else if (p.isBot && p.folded) {
      own[p.name] = `You folded ${cardsPhrase(p.holeCards)} in hand #${handNo}${made ? ` -- it would have made ${made}` : ""}. Only YOU know this unless you choose to show it.`;
    }
  }

  // --- Result sentence with the HONEST pot. --------------------------------
  const potWord = awardedBb >= 120 ? "a monster pot" : awardedBb >= 60 ? "a huge pot"
    : awardedBb >= 25 ? "a big pot" : awardedBb >= 10 ? "a decent pot" : "a small pot";
  const resultText = winner
    ? uncontested
      ? `${winner.name} took ${potWord} with no showdown -- nobody paid to see the hand.`
      : `${winner.name} won ${potWord} at showdown.`
    : "";
  const boardText = board.length ? `Board: ${board.join(" ")}.` : "No board -- it never got past preflop.";
  const faceUpText = faceUp.length
    ? ` Face-up: ${faceUp.map((f) => `${f.name} showed ${f.cards}${f.made ? ` (${f.made})` : ""}`).join("; ")}.`
    : "";

  const text = `Hand #${handNo}: ${actionText ? actionText + ". " : ""}${boardText} ${resultText}${faceUpText}`
    .replace(/\s+/g, " ").trim().slice(0, 900);

  return { handNo, text, faceUp, own };
}
