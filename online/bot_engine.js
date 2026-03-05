// AI Bot Engine for online poker.
// Runs client-side in the host's browser. Each bot has a personality
// that determines how aggressively/passively it plays.
// Includes opponent modeling, position awareness, c-bets, and check-raises.

import { describeSevenCardHand } from "./showdown.js";

const PERSONALITIES = ["TAG", "LAG", "Rock", "Station"];

const BOT_NAMES = [
  "Ace", "Maverick", "Chip", "Blaze", "Shadow", "Viper",
  "Duke", "Storm", "Hawk", "Jet", "Rex", "Finn",
  "Nova", "Sage", "Cruz", "Quinn", "Dash", "Knox"
];

const RANK_VAL = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

// ============ HAND STRENGTH ============

function preflopStrength(hole1, hole2) {
  if (!hole1 || !hole2 || hole1.length < 2 || hole2.length < 2) return 0.3;
  const r1 = RANK_VAL[hole1[0].toUpperCase()] || 5;
  const r2 = RANK_VAL[hole2[0].toUpperCase()] || 5;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const suited = hole1[1].toLowerCase() === hole2[1].toLowerCase();
  const paired = r1 === r2;

  let score = 0;
  if (paired) {
    score = 0.5 + (hi / 14) * 0.5;
  } else {
    const gap = hi - lo;
    score = (hi + lo) / 28;
    if (suited) score += 0.06;
    if (gap <= 1) score += 0.04;
    else if (gap <= 2) score += 0.02;
    if (hi >= 14) score += 0.08;
    else if (hi >= 13) score += 0.05;
    else if (hi >= 12) score += 0.03;
  }

  return Math.min(1.0, Math.max(0.0, score));
}

function postflopStrength(holeCards, boardCards) {
  if (!holeCards || holeCards.length < 2 || !boardCards || boardCards.length < 3) return 0.3;
  try {
    const allCards = [...holeCards, ...boardCards];
    const result = describeSevenCardHand(allCards);
    if (result.classRank == null) return 0.3;
    const base = result.classRank / 8;
    const kicker = (result.tuple[1] || 7) / 14;
    return Math.min(1.0, base * 0.75 + kicker * 0.25);
  } catch {
    return 0.3;
  }
}

function rand(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

function coinFlip(probability) {
  return Math.random() < probability;
}

// ============ OPPONENT TRACKER ============

export class OpponentTracker {
  constructor() {
    this.stats = new Map();
  }

  _ensure(playerId) {
    if (!this.stats.has(playerId)) {
      this.stats.set(playerId, {
        handsPlayed: 0,
        vpipCount: 0,
        pfrCount: 0,
        postflopBets: 0,
        postflopCalls: 0,
        foldToBetCount: 0,
        facedBetCount: 0,
      });
    }
    return this.stats.get(playerId);
  }

  recordHandStart(playerId) {
    this._ensure(playerId).handsPlayed++;
  }

  recordPreflopAction(playerId, actionType) {
    const s = this._ensure(playerId);
    if (actionType === "call" || actionType === "raise" || actionType === "all_in") s.vpipCount++;
    if (actionType === "raise" || actionType === "all_in") s.pfrCount++;
  }

  recordPostflopAction(playerId, actionType, facingBet) {
    const s = this._ensure(playerId);
    if (actionType === "bet" || actionType === "raise" || actionType === "all_in") s.postflopBets++;
    if (actionType === "call") s.postflopCalls++;
    if (facingBet) {
      s.facedBetCount++;
      if (actionType === "fold") s.foldToBetCount++;
    }
  }

  getProfile(playerId) {
    const s = this.stats.get(playerId);
    if (!s || s.handsPlayed < 3) return null;
    const vpip = s.vpipCount / s.handsPlayed;
    const pfr = s.pfrCount / s.handsPlayed;
    const aggActions = s.postflopBets;
    const passActions = s.postflopCalls;
    const aggression = passActions > 0 ? aggActions / passActions : aggActions > 0 ? 3.0 : 1.0;
    const foldToBet = s.facedBetCount > 0 ? s.foldToBetCount / s.facedBetCount : 0.5;

    return { vpip, pfr, aggression, foldToBet };
  }
}

function opponentAdjustments(opProfile) {
  if (!opProfile) return { bluffMod: 0, foldMod: 0, betMod: 0 };

  let bluffMod = 0;
  let foldMod = 0;
  let betMod = 0;

  if (opProfile.vpip > 0.5) {
    bluffMod -= 0.04;
    betMod += 0.05;
  } else if (opProfile.vpip < 0.25) {
    bluffMod += 0.06;
    foldMod -= 0.05;
  }

  if (opProfile.foldToBet > 0.6) {
    bluffMod += 0.08;
  } else if (opProfile.foldToBet < 0.3) {
    bluffMod -= 0.04;
    betMod += 0.04;
  }

  if (opProfile.aggression < 0.8) {
    betMod += 0.03;
  }

  return { bluffMod, foldMod, betMod };
}

// ============ POSITION AWARENESS ============

function positionMultiplier(seatNo, buttonSeat, totalSeats, activeSeatCount) {
  if (!buttonSeat || !totalSeats || activeSeatCount < 3) return 1.0;

  const dist = ((seatNo - buttonSeat + totalSeats) % totalSeats);
  const normalizedPos = dist / totalSeats;

  if (normalizedPos <= 0.15) return 1.15;
  if (normalizedPos <= 0.3) return 1.08;
  if (normalizedPos >= 0.7) return 0.88;
  if (normalizedPos >= 0.55) return 0.93;
  return 1.0;
}

// ============ PERSONALITY PROFILES ============

const PROFILES = {
  TAG: {
    preflopFoldBelow: 0.42,
    postflopFoldBelow: 0.25,
    raiseAbove: 0.65,
    bluffRate: 0.05,
    callRate: 0.7,
    betSizeMin: 0.5,
    betSizeMax: 0.8,
    preflopRaiseMulti: [2.5, 3.5],
    cbetRate: 0.68,
    checkRaiseRate: 0.06,
  },
  LAG: {
    preflopFoldBelow: 0.28,
    postflopFoldBelow: 0.18,
    raiseAbove: 0.5,
    bluffRate: 0.15,
    callRate: 0.8,
    betSizeMin: 0.4,
    betSizeMax: 1.0,
    preflopRaiseMulti: [2.0, 4.0],
    cbetRate: 0.75,
    checkRaiseRate: 0.10,
  },
  Rock: {
    preflopFoldBelow: 0.52,
    postflopFoldBelow: 0.35,
    raiseAbove: 0.75,
    callRate: 0.85,
    bluffRate: 0.02,
    betSizeMin: 0.4,
    betSizeMax: 0.6,
    preflopRaiseMulti: [2.5, 3.0],
    cbetRate: 0.55,
    checkRaiseRate: 0.03,
  },
  Station: {
    preflopFoldBelow: 0.2,
    postflopFoldBelow: 0.15,
    raiseAbove: 0.8,
    callRate: 0.92,
    bluffRate: 0.03,
    betSizeMin: 0.3,
    betSizeMax: 0.5,
    preflopRaiseMulti: [2.0, 2.5],
    cbetRate: 0.45,
    checkRaiseRate: 0.02,
  },
};

export function randomPersonality() {
  return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

export function randomBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

export function personalityLabel(p) {
  switch (p) {
    case "TAG": return "Tight-Agg";
    case "LAG": return "Loose-Agg";
    case "Rock": return "Rock";
    case "Station": return "Caller";
    default: return p;
  }
}

// ============ DECISION ENGINE ============

export function decide({
  personality, holeCards, boardCards, pot, currentBet, streetContribution,
  stackEnd, bigBlind, street,
  seatNo, buttonSeat, totalSeats, activeSeatCount,
  wasAggressor, opponentProfile,
}) {
  const profile = PROFILES[personality] || PROFILES.TAG;
  const toCall = Math.max(0, (currentBet || 0) - (streetContribution || 0));
  const stack = stackEnd || 0;
  const isPreflop = street === "preflop" || !boardCards || boardCards.length < 3;
  const isFlop = street === "flop";

  if (stack <= 0) return { actionType: "check", amount: null };

  // Base hand strength
  const rawStrength = isPreflop
    ? preflopStrength(holeCards?.[0], holeCards?.[1])
    : postflopStrength(holeCards, boardCards);

  // Position adjustment: play looser in late position, tighter early
  const posMult = positionMultiplier(seatNo || 0, buttonSeat || 0, totalSeats || 6, activeSeatCount || 2);

  // Opponent-based adjustments
  const opAdj = opponentAdjustments(opponentProfile || null);

  const noise = rand(-0.08, 0.08);
  const effectiveStrength = Math.min(1.0, Math.max(0.0, rawStrength * posMult + noise));

  const adjustedBluffRate = Math.max(0, Math.min(0.3, profile.bluffRate + opAdj.bluffMod));
  const adjustedFoldThreshold = isPreflop
    ? Math.max(0.1, profile.preflopFoldBelow + opAdj.foldMod)
    : Math.max(0.1, profile.postflopFoldBelow + opAdj.foldMod);
  const adjustedRaiseAbove = Math.max(0.3, profile.raiseAbove - opAdj.betMod);

  // ---- CONTINUATION BET ----
  // If bot was the preflop aggressor and it's the flop with no bet yet, c-bet frequently
  if (isFlop && wasAggressor && currentBet === 0 && toCall === 0) {
    if (coinFlip(profile.cbetRate)) {
      const cbetSize = Math.max(Math.round(pot * rand(0.4, 0.7)), bigBlind || 2);
      if (cbetSize < stack) {
        return { actionType: "bet", amount: cbetSize };
      }
    }
  }

  // ---- CHECK-RAISE (trap with strong hands) ----
  if (!isPreflop && effectiveStrength >= 0.7 && currentBet === 0 && toCall === 0) {
    if (coinFlip(profile.checkRaiseRate)) {
      return { actionType: "check", amount: null };
    }
  }

  // ---- FOLD DECISION ----
  if (effectiveStrength < adjustedFoldThreshold && toCall > 0) {
    // Bluff chance
    if (coinFlip(adjustedBluffRate) && stack > toCall * 2) {
      const bluffSize = Math.round(pot * rand(0.5, 0.8));
      const raiseTarget = Math.max((currentBet || 0) + (bigBlind || 2), (currentBet || 0) + bluffSize);
      if (raiseTarget <= (streetContribution || 0) + stack) {
        return { actionType: currentBet > 0 ? "raise" : "bet", amount: Math.min(raiseTarget, (streetContribution || 0) + stack) };
      }
    }
    return toCall > 0 ? { actionType: "fold", amount: null } : { actionType: "check", amount: null };
  }

  // ---- STRONG HAND: RAISE/BET ----
  if (effectiveStrength >= adjustedRaiseAbove) {
    const sizeFrac = rand(profile.betSizeMin, profile.betSizeMax);
    if (currentBet > 0) {
      const raiseSize = Math.max(Math.round(pot * sizeFrac), bigBlind || 2);
      const raiseTarget = (currentBet || 0) + raiseSize;
      if (raiseTarget > (streetContribution || 0) + stack) {
        return { actionType: "all_in", amount: null };
      }
      return { actionType: "raise", amount: raiseTarget };
    } else {
      const betSize = Math.max(Math.round(pot * sizeFrac), bigBlind || 2);
      if (betSize >= stack) {
        return { actionType: "all_in", amount: null };
      }
      return { actionType: "bet", amount: betSize };
    }
  }

  // ---- MEDIUM HAND: CALL/CHECK ----
  if (toCall > 0) {
    if (toCall > stack) {
      return coinFlip(profile.callRate) ? { actionType: "all_in", amount: null } : { actionType: "fold", amount: null };
    }

    // Pot odds: compare required equity to hand strength
    const potOdds = toCall / (pot + toCall);
    if (effectiveStrength < potOdds * 1.1) {
      return coinFlip(0.2) ? { actionType: "call", amount: null } : { actionType: "fold", amount: null };
    }

    return coinFlip(profile.callRate) ? { actionType: "call", amount: null } : { actionType: "fold", amount: null };
  }

  // ---- NO BET TO CALL: CHECK OR PROBE BET ----
  if (effectiveStrength > adjustedFoldThreshold + 0.15 && coinFlip(0.3)) {
    const betSize = Math.max(Math.round(pot * rand(0.3, 0.5)), bigBlind || 2);
    if (betSize < stack) {
      return { actionType: "bet", amount: betSize };
    }
  }

  return { actionType: "check", amount: null };
}

export function thinkTimeMs() {
  return 1000 + Math.floor(Math.random() * 2000);
}
