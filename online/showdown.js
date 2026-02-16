// Texas Hold'em showdown evaluator + payout resolver (server-side helper).
// Used by backend runtime to build `p_payouts` for `online_settle_showdown`.

const RANK_TO_VALUE = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

function toCard(token) {
  const value = (token || "").toUpperCase().trim();
  if (value.length !== 2) throw new Error(`Invalid card token: ${token}`);
  const rank = value[0];
  const suit = value[1];
  if (!RANK_TO_VALUE[rank]) throw new Error(`Invalid rank in card token: ${token}`);
  if (!["S", "H", "D", "C"].includes(suit)) throw new Error(`Invalid suit in card token: ${token}`);
  return { rank: RANK_TO_VALUE[rank], suit };
}

function rankCounts(cards) {
  const counts = new Map();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  return counts;
}

function sortedRanksDesc(cards) {
  return [...new Set(cards.map((c) => c.rank))].sort((a, b) => b - a);
}

function straightHighFromRanks(ranks) {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniq.includes(14)) uniq.push(1); // wheel
  for (let i = 0; i <= uniq.length - 5; i += 1) {
    const slice = uniq.slice(i, i + 5);
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) {
      return slice[0] === 1 ? 5 : slice[0];
    }
  }
  return null;
}

function compareTuples(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function best5Rank(cards7) {
  if (cards7.length < 5) throw new Error("Need at least 5 cards");

  const suits = new Map();
  for (const c of cards7) {
    if (!suits.has(c.suit)) suits.set(c.suit, []);
    suits.get(c.suit).push(c);
  }

  let flushSuit = null;
  for (const [suit, cards] of suits.entries()) {
    if (cards.length >= 5) {
      flushSuit = suit;
      break;
    }
  }

  if (flushSuit) {
    const flushCards = suits.get(flushSuit).sort((a, b) => b.rank - a.rank);
    const sfHigh = straightHighFromRanks(flushCards.map((c) => c.rank));
    if (sfHigh) return [8, sfHigh]; // straight flush
  }

  const counts = rankCounts(cards7);
  const byCountThenRank = [...counts.entries()].sort((a, b) => {
    const countDiff = b[1] - a[1];
    if (countDiff !== 0) return countDiff;
    return b[0] - a[0];
  });

  const quads = byCountThenRank.find(([, c]) => c === 4);
  if (quads) {
    const quadRank = quads[0];
    const kicker = sortedRanksDesc(cards7.filter((c) => c.rank !== quadRank))[0] || 0;
    return [7, quadRank, kicker];
  }

  const trips = byCountThenRank.filter(([, c]) => c === 3).map(([r]) => r).sort((a, b) => b - a);
  const pairs = byCountThenRank.filter(([, c]) => c >= 2).map(([r]) => r).sort((a, b) => b - a);
  if (trips.length >= 1) {
    const tripRank = trips[0];
    const pairRank = pairs.find((r) => r !== tripRank);
    if (pairRank) return [6, tripRank, pairRank]; // full house
  }

  if (flushSuit) {
    const top5 = suits
      .get(flushSuit)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 5)
      .map((c) => c.rank);
    return [5, ...top5];
  }

  const straightHigh = straightHighFromRanks(cards7.map((c) => c.rank));
  if (straightHigh) return [4, straightHigh];

  if (trips.length >= 1) {
    const tripRank = trips[0];
    const kickers = sortedRanksDesc(cards7.filter((c) => c.rank !== tripRank)).slice(0, 2);
    return [3, tripRank, ...kickers];
  }

  const pairRanks = byCountThenRank.filter(([, c]) => c === 2).map(([r]) => r).sort((a, b) => b - a);
  if (pairRanks.length >= 2) {
    const [highPair, lowPair] = pairRanks.slice(0, 2);
    const kicker = sortedRanksDesc(cards7.filter((c) => c.rank !== highPair && c.rank !== lowPair))[0] || 0;
    return [2, highPair, lowPair, kicker];
  }

  if (pairRanks.length === 1) {
    const pair = pairRanks[0];
    const kickers = sortedRanksDesc(cards7.filter((c) => c.rank !== pair)).slice(0, 3);
    return [1, pair, ...kickers];
  }

  const highs = sortedRanksDesc(cards7).slice(0, 5);
  return [0, ...highs];
}

export function compareHands(cardsA, cardsB) {
  return compareTuples(best5Rank(cardsA), best5Rank(cardsB));
}

function computeSidePots(players) {
  const sorted = players
    .map((p) => ({
      seatNo: p.seatNo,
      committed: Math.max(0, Number(p.committed || 0)),
      folded: !!p.folded
    }))
    .sort((a, b) => a.committed - b.committed);

  const pots = [];
  let prev = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i].committed;
    if (tier <= prev) continue;
    const contrib = sorted.slice(i);
    const amount = (tier - prev) * contrib.length;
    const eligible = contrib.filter((p) => !p.folded).map((p) => p.seatNo);
    pots.push({ amount, eligible });
    prev = tier;
  }
  return pots;
}

function splitCents(totalCents, seats) {
  if (seats.length === 0) return [];
  const base = Math.floor(totalCents / seats.length);
  let rem = totalCents - base * seats.length;
  return seats.map((seatNo, idx) => ({
    seatNo,
    cents: base + (idx < rem ? 1 : 0)
  }));
}

export function resolveShowdownPayouts({ boardCards, players }) {
  const board = (boardCards || []).map(toCard);
  if (board.length !== 5) throw new Error("Board must contain exactly 5 cards.");

  const normalizedPlayers = (players || []).map((p) => ({
    seatNo: Number(p.seatNo),
    folded: !!p.folded,
    committed: Number(p.committed || 0),
    hole: (p.holeCards || []).map(toCard)
  }));

  for (const p of normalizedPlayers) {
    if (p.hole.length !== 2) throw new Error(`Seat ${p.seatNo} must have 2 hole cards.`);
  }

  const sidePots = computeSidePots(normalizedPlayers);
  const payoutCents = new Map();
  for (const p of normalizedPlayers) payoutCents.set(p.seatNo, 0);

  for (const pot of sidePots) {
    const contenders = normalizedPlayers.filter((p) => pot.eligible.includes(p.seatNo));
    if (contenders.length === 0) continue;

    let best = null;
    let winners = [];
    for (const c of contenders) {
      const cards = [...c.hole, ...board];
      const rank = best5Rank(cards);
      if (!best || compareTuples(rank, best) > 0) {
        best = rank;
        winners = [c.seatNo];
      } else if (compareTuples(rank, best) === 0) {
        winners.push(c.seatNo);
      }
    }

    const cents = Math.round(Number(pot.amount || 0) * 100);
    const shares = splitCents(cents, winners.sort((a, b) => a - b));
    for (const share of shares) {
      payoutCents.set(share.seatNo, (payoutCents.get(share.seatNo) || 0) + share.cents);
    }
  }

  const payouts = [...payoutCents.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([seatNo, cents]) => ({ seat_no: seatNo, amount: Number((cents / 100).toFixed(2)) }))
    .sort((a, b) => a.seat_no - b.seat_no);

  return payouts;
}
