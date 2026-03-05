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

// Bitmask straight detection: each rank 2-14 maps to a bit position.
// Bit 0 = rank 2, bit 12 = rank 14 (Ace). Bit 13 = rank 1 (Ace low for wheel).
const STRAIGHT_MASKS = [];
(function initStraightMasks() {
  for (let high = 14; high >= 5; high--) {
    let mask = 0;
    for (let r = high; r > high - 5; r--) mask |= (1 << (r - 2));
    STRAIGHT_MASKS.push({ mask, high });
  }
  STRAIGHT_MASKS.push({ mask: (1 << 12) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3), high: 5 });
})();

function straightHighFromBitmask(bitmask) {
  for (const { mask, high } of STRAIGHT_MASKS) {
    if ((bitmask & mask) === mask) return high;
  }
  return 0;
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

  // Count ranks and suits using fixed arrays (faster than Map)
  const rc = new Uint8Array(15); // rc[2..14] = count per rank
  const suitCounts = [0, 0, 0, 0]; // S=0, H=1, D=2, C=3
  const suitIdx = { S: 0, H: 1, D: 2, C: 3 };
  const suitCards = [[], [], [], []];

  for (const c of cards7) {
    rc[c.rank]++;
    const si = suitIdx[c.suit];
    suitCounts[si]++;
    suitCards[si].push(c.rank);
  }

  // Flush detection
  let flushSi = -1;
  for (let i = 0; i < 4; i++) { if (suitCounts[i] >= 5) { flushSi = i; break; } }

  // Straight flush check using bitmask
  if (flushSi >= 0) {
    let fMask = 0;
    for (const r of suitCards[flushSi]) fMask |= (1 << (r - 2));
    const sfHigh = straightHighFromBitmask(fMask);
    if (sfHigh) return [8, sfHigh];
  }

  // Categorize ranks by count
  const quads = [];
  const trips = [];
  const pairsArr = [];
  const singles = [];
  for (let r = 14; r >= 2; r--) {
    if (rc[r] === 4) quads.push(r);
    else if (rc[r] === 3) trips.push(r);
    else if (rc[r] === 2) pairsArr.push(r);
    else if (rc[r] === 1) singles.push(r);
  }

  // Four of a kind
  if (quads.length > 0) {
    const qr = quads[0];
    let kicker = 0;
    for (let r = 14; r >= 2; r--) { if (r !== qr && rc[r] > 0) { kicker = r; break; } }
    return [7, qr, kicker];
  }

  // Full house
  if (trips.length >= 1) {
    const tripRank = trips[0];
    const pairRank = trips.length >= 2 ? trips[1] : (pairsArr.length > 0 ? pairsArr[0] : 0);
    if (pairRank > 0) return [6, tripRank, pairRank];
  }

  // Flush (no straight flush already checked)
  if (flushSi >= 0) {
    const fRanks = suitCards[flushSi].sort((a, b) => b - a).slice(0, 5);
    return [5, ...fRanks];
  }

  // Straight using bitmask on all ranks
  let allMask = 0;
  for (let r = 2; r <= 14; r++) { if (rc[r] > 0) allMask |= (1 << (r - 2)); }
  const stHigh = straightHighFromBitmask(allMask);
  if (stHigh) return [4, stHigh];

  // Three of a kind (no full house)
  if (trips.length >= 1) {
    const tr = trips[0];
    const kickers = [];
    for (let r = 14; r >= 2 && kickers.length < 2; r--) {
      if (r !== tr && rc[r] > 0) kickers.push(r);
    }
    return [3, tr, ...kickers];
  }

  // Two pair
  if (pairsArr.length >= 2) {
    const hp = pairsArr[0];
    const lp = pairsArr[1];
    let kicker = 0;
    for (let r = 14; r >= 2; r--) { if (r !== hp && r !== lp && rc[r] > 0) { kicker = r; break; } }
    return [2, hp, lp, kicker];
  }

  // One pair
  if (pairsArr.length === 1) {
    const pr = pairsArr[0];
    const kickers = [];
    for (let r = 14; r >= 2 && kickers.length < 3; r--) {
      if (r !== pr && rc[r] > 0) kickers.push(r);
    }
    return [1, pr, ...kickers];
  }

  // High card
  const highs = [];
  for (let r = 14; r >= 2 && highs.length < 5; r--) { if (rc[r] > 0) highs.push(r); }
  return [0, ...highs];
}

const HAND_CLASS_NAMES = {
  8: "Straight Flush",
  7: "Four of a Kind",
  6: "Full House",
  5: "Flush",
  4: "Straight",
  3: "Three of a Kind",
  2: "Two Pair",
  1: "One Pair",
  0: "High Card"
};

function rankToFace(rankValue) {
  if (rankValue === 14) return "A";
  if (rankValue === 13) return "K";
  if (rankValue === 12) return "Q";
  if (rankValue === 11) return "J";
  if (rankValue === 10) return "10";
  if (rankValue === 1) return "A";
  return String(rankValue || "");
}

export function describeSevenCardHand(cardTokens) {
  const cards = (cardTokens || []).map(toCard);
  if (cards.length < 5) {
    return { classRank: null, className: "", label: "", tuple: [] };
  }

  const tuple = best5Rank(cards);
  const classRank = Number(tuple[0]);
  const className = HAND_CLASS_NAMES[classRank] || "Hand";
  let label = className;

  if (classRank === 8 && Number(tuple[1]) === 14) {
    label = "Royal Flush";
  } else if (classRank === 4 || classRank === 8) {
    label = `${className} (${rankToFace(tuple[1])} high)`;
  } else if (classRank === 7 || classRank === 3 || classRank === 1) {
    label = `${className} (${rankToFace(tuple[1])})`;
  }

  return { classRank, className, label, tuple };
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
