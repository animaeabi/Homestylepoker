// Monte Carlo hand equity for postflop decisions. The heuristic strength score
// in bot_engine is a decent proxy but it can't see runners, backdoor outs, or
// how a hand fares multiway. This deals out random opponent hands + the missing
// board cards many times and counts how often we win, giving a real
// win-probability in [0,1]. Pure + bounded so it stays inside the bot's
// think-time budget.

import { describeSevenCardHand } from "./showdown.ts";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["S", "H", "D", "C"];

function fullDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) deck.push(r + s);
  }
  return deck;
}

function normToken(token: string): string {
  const t = String(token || "").trim().toUpperCase();
  return t.length === 2 ? t : t;
}

// Lexicographic compare of two hand-rank tuples (class first, then kickers).
function compareTuple(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

// Win probability of holeCards on boardCards against `opponents` random hands.
// Draws split the pot (tie credit = 1 / number of players tied at the top).
// Returns 0.5 on any degenerate input so callers never over/under-commit on bad
// data.
export function monteCarloEquity({
  holeCards,
  boardCards,
  opponents = 1,
  samples,
}: {
  holeCards: string[];
  boardCards: string[];
  opponents?: number;
  samples?: number;
}): number {
  const hole = (holeCards || []).map(normToken).filter((t) => t.length === 2);
  const board = (boardCards || []).map(normToken).filter((t) => t.length === 2);
  if (hole.length < 2) return 0.5;

  const known = new Set<string>([...hole, ...board]);
  if (known.size !== hole.length + board.length) return 0.5; // dup/corrupt cards
  const deck = fullDeck().filter((c) => !known.has(c));

  const boardNeed = Math.max(0, 5 - board.length);
  const opp = Math.max(1, Math.min(Number(opponents || 1), 4));
  const need = boardNeed + opp * 2;
  if (deck.length < need) return 0.5;

  // Scale samples down as the table gets more multiway so total evaluations stay
  // roughly constant; clamp to a sane band.
  const N = Math.max(60, Math.min(260, Math.floor(samples || 720 / (opp + 1))));

  let score = 0;
  const d = deck.slice();
  const dl = d.length;
  for (let s = 0; s < N; s += 1) {
    // Partial Fisher-Yates: shuffle only the `need` cards we draw this sample.
    for (let i = 0; i < need; i += 1) {
      const j = i + Math.floor(Math.random() * (dl - i));
      const tmp = d[i];
      d[i] = d[j];
      d[j] = tmp;
    }
    const runout = board.concat(d.slice(0, boardNeed));
    const oppStart = boardNeed;

    const myTuple = describeSevenCardHand(hole.concat(runout)).tuple;
    let tiedAtTop = 1;
    let lost = false;
    for (let o = 0; o < opp; o += 1) {
      const oc = [d[oppStart + o * 2], d[oppStart + o * 2 + 1]];
      const oppTuple = describeSevenCardHand(oc.concat(runout)).tuple;
      const cmp = compareTuple(oppTuple, myTuple);
      if (cmp > 0) {
        lost = true;
        break;
      }
      if (cmp === 0) tiedAtTop += 1;
    }
    if (!lost) score += 1 / tiedAtTop;
  }
  return score / N;
}
