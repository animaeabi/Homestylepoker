// Monte Carlo hand equity for postflop decisions. The heuristic strength score
// in bot_engine is a decent proxy but it can't see runners, backdoor outs, or
// how a hand fares multiway. This deals out random opponent hands + the missing
// board cards many times and counts how often we win, giving a real
// win-probability in [0,1]. Pure + bounded so it stays inside the bot's
// think-time budget.
//
// With `villainTightness > 0` it stops assuming opponents hold random junk: each
// sampled opponent hand is biased toward cards that actually connect with the
// board (pairs, draws, overpairs), by an amount the caller infers from the
// betting line. That is the "hand reading" layer -- a villain who has been
// betting big into a wet board is modelled as holding a real hand, which lowers
// our equity the way a live read would.

import { describeSevenCardHand } from "./showdown.ts";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["S", "H", "D", "C"];
const RANK_VALUE: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

function fullDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) deck.push(r + s);
  }
  return deck;
}

function normToken(token: string): string {
  return String(token || "").trim().toUpperCase();
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

// Rough [0,1] score of how well a two-card holding connects with the board --
// used only to weight the opponent range under `villainTightness`. Cheap on
// purpose (no full 7-card eval per candidate): pairs, overpairs, and flush/
// straight draws are what a betting range is made of.
function connectScore(c1: string, c2: string, board: string[]): number {
  const r1 = RANK_VALUE[c1[0]] || 0;
  const r2 = RANK_VALUE[c2[0]] || 0;
  const s1 = c1[1];
  const s2 = c2[1];
  const boardRanks = board.map((c) => RANK_VALUE[c[0]] || 0);
  const boardSuits = board.map((c) => c[1]);
  const maxBoard = boardRanks.length ? Math.max(...boardRanks) : 0;

  let score = 0.12;

  if (r1 === r2) {
    // Pocket pair: set if it hits the board, overpair if above it, else a middling pair.
    if (boardRanks.includes(r1)) score += 0.55;
    else if (r1 > maxBoard) score += 0.45;
    else score += 0.22;
  } else {
    const pairsBoard = boardRanks.includes(r1) || boardRanks.includes(r2);
    if (pairsBoard) {
      const paired = boardRanks.includes(r1) ? r1 : r2;
      score += paired >= maxBoard ? 0.4 : 0.24; // top pair vs middle/bottom
    }
    if (r1 >= 12 && r2 >= 12) score += 0.1; // two big cards / overcards
  }

  // Flush draw / made flush texture with a suited holding.
  if (s1 === s2) {
    const suitedBoard = boardSuits.filter((s) => s === s1).length;
    if (suitedBoard >= 3) score += 0.5;
    else if (suitedBoard === 2) score += 0.18;
  }

  // Loose straightiness: connectors near board ranks.
  if (Math.abs(r1 - r2) <= 2 && boardRanks.some((b) => Math.abs(b - r1) <= 2 || Math.abs(b - r2) <= 2)) {
    score += 0.12;
  }

  return score > 1 ? 1 : score;
}

// Win probability of holeCards on boardCards against `opponents` hands. Draws
// split the pot (tie credit = 1 / number tied at the top). `villainTightness`
// in [0,1] biases opponents toward board-connected holdings (0 = random).
// Returns 0.5 on any degenerate input so callers never over/under-commit on bad
// data.
export function monteCarloEquity({
  holeCards,
  boardCards,
  opponents = 1,
  samples,
  villainTightness = 0,
}: {
  holeCards: string[];
  boardCards: string[];
  opponents?: number;
  samples?: number;
  villainTightness?: number;
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

  const tight = Math.max(0, Math.min(1, Number(villainTightness || 0)));
  // Scale samples down as the table gets more multiway so total evaluations stay
  // roughly constant; clamp to a sane band.
  const N = Math.max(60, Math.min(260, Math.floor(samples || 720 / (opp + 1))));

  let score = 0;
  const d = deck.slice();
  const dl = d.length;

  for (let s = 0; s < N; s += 1) {
    // Partial Fisher-Yates: shuffle the board runout, and (fast path) the
    // opponent cards too.
    const drawCount = tight > 0 ? boardNeed : need;
    for (let i = 0; i < drawCount; i += 1) {
      const j = i + Math.floor(Math.random() * (dl - i));
      const tmp = d[i];
      d[i] = d[j];
      d[j] = tmp;
    }
    const runout = board.concat(d.slice(0, boardNeed));

    // Deal opponent hands.
    const oppHands: string[][] = [];
    if (tight > 0) {
      // Range-weighted: rejection-sample each opponent toward connected hands.
      const used = new Set<string>(runout);
      const pool = deck.filter((c) => !used.has(c));
      for (let o = 0; o < opp; o += 1) {
        let chosen: string[] | null = null;
        let fallback: string[] = [];
        let fallbackScore = -1;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          let a = pool[Math.floor(Math.random() * pool.length)];
          let b = pool[Math.floor(Math.random() * pool.length)];
          let guard = 0;
          while ((a === b || used.has(a) || used.has(b)) && guard < 20) {
            a = pool[Math.floor(Math.random() * pool.length)];
            b = pool[Math.floor(Math.random() * pool.length)];
            guard += 1;
          }
          if (a === b || used.has(a) || used.has(b)) continue;
          const q = connectScore(a, b, runout);
          const acceptProb = Math.max(0.03, Math.min(1, (1 - tight) + tight * q));
          if (Math.random() < acceptProb) {
            chosen = [a, b];
            break;
          }
          if (q > fallbackScore) {
            fallbackScore = q;
            fallback = [a, b];
          }
        }
        const hand = chosen || fallback;
        if (hand.length < 2) {
          // Pool exhausted or bad luck; skip this sample cleanly.
          oppHands.length = 0;
          break;
        }
        used.add(hand[0]);
        used.add(hand[1]);
        oppHands.push(hand);
      }
      if (oppHands.length !== opp) continue;
    } else {
      const oppStart = boardNeed;
      for (let o = 0; o < opp; o += 1) {
        oppHands.push([d[oppStart + o * 2], d[oppStart + o * 2 + 1]]);
      }
    }

    const myTuple = describeSevenCardHand(hole.concat(runout)).tuple;
    let tiedAtTop = 1;
    let lost = false;
    for (let o = 0; o < opp; o += 1) {
      const oppTuple = describeSevenCardHand(oppHands[o].concat(runout)).tuple;
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
