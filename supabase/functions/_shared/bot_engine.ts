import { describeSevenCardHand } from "./showdown.ts";

export type BotPersonality = "TAG" | "LAG" | "Rock" | "Station";
export type OpponentTag =
  | "nit"
  | "tag"
  | "lag"
  | "station"
  | "trapper"
  | "bluff-heavy"
  | "river-overfolder";
export type OpponentState =
  | "tilting"
  | "protecting_stack"
  | "bullying"
  | "sticky_after_showdown";
export type OpponentProfileBucket = {
  hands_observed?: number | string | null;
  vpip_hands?: number | string | null;
  pfr_hands?: number | string | null;
  faced_bet_events?: number | string | null;
  fold_to_bet_events?: number | string | null;
  postflop_bet_events?: number | string | null;
  postflop_call_events?: number | string | null;
  river_faced_bet_events?: number | string | null;
  river_fold_events?: number | string | null;
  showdown_wins?: number | string | null;
  showdown_losses?: number | string | null;
  aggressive_showdown_losses?: number | string | null;
  trap_showdown_wins?: number | string | null;
  net_result?: number | string | null;
  recent_aggression_ema?: number | string | null;
  recent_call_ema?: number | string | null;
  recent_fold_ema?: number | string | null;
  consecutive_losses?: number | string | null;
  last_showdown_result?: string | null;
  last_showdown_at?: string | null;
  actions_since_showdown?: number | string | null;
};
export type OpponentProfileInput = {
  seatNo?: number | null;
  playerName?: string | null;
  stack?: number | null;
  bigBlind?: number | null;
  avgStackBb?: number | null;
  overall?: OpponentProfileBucket | null;
  session?: OpponentProfileBucket | null;
};
export type OpponentProfile = {
  vpip: number;
  pfr: number;
  aggression: number;
  foldToBet: number;
  riverFoldToBet: number;
  confidence: number;
  tags: OpponentTag[];
  states: OpponentState[];
  playerName?: string | null;
  seatNo?: number | null;
  stackBb?: number | null;
  avgStackBb?: number | null;
  playersConsidered?: number;
} | null;

const STYLE_TAGS: OpponentTag[] = ["nit", "tag", "lag", "station"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toNum(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rate(numerator: unknown, denominator: unknown, fallback: number) {
  const denom = toNum(denominator, 0);
  if (denom <= 0) return fallback;
  return clamp(toNum(numerator, 0) / denom, 0, 1);
}

function weightedAverage(values: number[], weights: number[], fallback: number) {
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    const weight = Math.max(0, Number(weights[i] || 0));
    numerator += values[i] * weight;
    denominator += weight;
  }
  if (denominator <= 0) return fallback;
  return numerator / denominator;
}

function profileMetricsFromBucket(bucket?: OpponentProfileBucket | null) {
  const handsObserved = toNum(bucket?.hands_observed, 0);
  const facedBetEvents = toNum(bucket?.faced_bet_events, 0);
  const foldToBetEvents = toNum(bucket?.fold_to_bet_events, 0);
  const postflopBetEvents = toNum(bucket?.postflop_bet_events, 0);
  const postflopCallEvents = toNum(bucket?.postflop_call_events, 0);
  const riverFacedBetEvents = toNum(bucket?.river_faced_bet_events, 0);
  const riverFoldEvents = toNum(bucket?.river_fold_events, 0);
  const showdownWins = toNum(bucket?.showdown_wins, 0);
  const showdownLosses = toNum(bucket?.showdown_losses, 0);
  const aggressiveShowdownLosses = toNum(bucket?.aggressive_showdown_losses, 0);
  const trapShowdownWins = toNum(bucket?.trap_showdown_wins, 0);

  const vpip = rate(bucket?.vpip_hands, handsObserved, 0.28);
  const pfr = rate(bucket?.pfr_hands, handsObserved, 0.16);
  const foldToBet = rate(foldToBetEvents, facedBetEvents, 0.46);
  const riverFoldToBet = rate(riverFoldEvents, riverFacedBetEvents, 0.46);
  const aggression = postflopCallEvents > 0
    ? postflopBetEvents / postflopCallEvents
    : postflopBetEvents > 0 ? 3 : 1;
  const aggressiveShowdownLossRate = rate(aggressiveShowdownLosses, showdownLosses, 0);
  const trapShowdownWinRate = rate(trapShowdownWins, showdownWins, 0);

  return {
    handsObserved,
    facedBetEvents,
    postflopActions: postflopBetEvents + postflopCallEvents,
    riverFacedBetEvents,
    vpip,
    pfr,
    foldToBet,
    riverFoldToBet,
    aggression,
    aggressiveShowdownLossRate,
    trapShowdownWinRate,
    netResult: toNum(bucket?.net_result, 0),
    recentAggressionEma: clamp(toNum(bucket?.recent_aggression_ema, 0), 0, 1),
    recentCallEma: clamp(toNum(bucket?.recent_call_ema, 0), 0, 1),
    recentFoldEma: clamp(toNum(bucket?.recent_fold_ema, 0), 0, 1),
    consecutiveLosses: Math.max(0, Math.floor(toNum(bucket?.consecutive_losses, 0))),
    lastShowdownResult: String(bucket?.last_showdown_result || "").toLowerCase() || null,
    actionsSinceShowdown: Math.max(0, Math.floor(toNum(bucket?.actions_since_showdown, 999))),
  };
}

export function classifyOpponentProfile(input: OpponentProfileInput): OpponentProfile {
  const overallMetrics = profileMetricsFromBucket(input?.overall);
  const sessionMetrics = profileMetricsFromBucket(input?.session);
  const overallWeight = clamp(overallMetrics.handsObserved, 0, 45) * 0.85;
  const sessionWeight = clamp(sessionMetrics.handsObserved, 0, 18) * 1.35;

  const vpip = weightedAverage(
    [overallMetrics.vpip, sessionMetrics.vpip],
    [overallWeight, sessionWeight],
    0.28
  );
  const pfr = weightedAverage(
    [overallMetrics.pfr, sessionMetrics.pfr],
    [overallWeight, sessionWeight],
    0.16
  );
  const aggression = weightedAverage(
    [overallMetrics.aggression, sessionMetrics.aggression],
    [Math.max(overallMetrics.postflopActions, 1), Math.max(sessionMetrics.postflopActions * 1.5, 1)],
    1
  );
  const foldToBet = weightedAverage(
    [overallMetrics.foldToBet, sessionMetrics.foldToBet],
    [Math.max(overallMetrics.facedBetEvents, 1), Math.max(sessionMetrics.facedBetEvents * 1.5, 1)],
    0.46
  );
  const riverFoldToBet = weightedAverage(
    [overallMetrics.riverFoldToBet, sessionMetrics.riverFoldToBet],
    [Math.max(overallMetrics.riverFacedBetEvents, 0.4), Math.max(sessionMetrics.riverFacedBetEvents * 1.6, 0.4)],
    foldToBet
  );

  const confidence = clamp(
    0.14
      + clamp((overallMetrics.handsObserved * 0.6 + sessionMetrics.handsObserved * 1.3) / 26, 0, 1) * 0.56
      + clamp((overallMetrics.facedBetEvents + sessionMetrics.facedBetEvents * 1.3) / 10, 0, 1) * 0.18
      + clamp((overallMetrics.postflopActions + sessionMetrics.postflopActions) / 16, 0, 1) * 0.12,
    0.14,
    0.98
  );

  const tags: OpponentTag[] = [];
  const styleThreshold = confidence >= 0.34;
  if (styleThreshold) {
    if (vpip <= 0.2 && pfr <= 0.13) tags.push("nit");
    else if (vpip >= 0.37 && pfr < 0.18 && foldToBet <= 0.4) tags.push("station");
    else if (vpip >= 0.34 && pfr >= 0.24 && aggression >= 1.3) tags.push("lag");
    else if (vpip >= 0.2 && vpip <= 0.31 && pfr >= 0.15 && pfr <= 0.26 && aggression >= 0.95) tags.push("tag");
  }

  if (confidence >= 0.42 && weightedAverage(
    [overallMetrics.trapShowdownWinRate, sessionMetrics.trapShowdownWinRate],
    [Math.max(overallMetrics.handsObserved, 1), Math.max(sessionMetrics.handsObserved * 1.8, 1)],
    0
  ) >= 0.24 && aggression <= 1.02) {
    tags.push("trapper");
  }

  if (confidence >= 0.36 && weightedAverage(
    [overallMetrics.aggressiveShowdownLossRate, sessionMetrics.aggressiveShowdownLossRate],
    [Math.max(overallMetrics.handsObserved, 1), Math.max(sessionMetrics.handsObserved * 1.7, 1)],
    0
  ) >= 0.38 && aggression >= 1.55) {
    tags.push("bluff-heavy");
  }

  if (confidence >= 0.4 && riverFoldToBet >= 0.62) {
    tags.push("river-overfolder");
  }

  const bigBlind = Math.max(1, toNum(input?.bigBlind, 2));
  const stack = toNum(input?.stack, 0);
  const stackBb = stack > 0 ? stack / bigBlind : null;
  const avgStackBb = toNum(input?.avgStackBb, 0) > 0 ? toNum(input?.avgStackBb, 0) : null;
  const states: OpponentState[] = [];

  if (
    sessionMetrics.consecutiveLosses >= 2
    && sessionMetrics.netResult <= -(bigBlind * 8)
    && sessionMetrics.recentAggressionEma >= 0.46
  ) {
    states.push("tilting");
  }

  if (stackBb !== null && stackBb <= 24 && sessionMetrics.recentFoldEma >= 0.34) {
    states.push("protecting_stack");
  }

  if (
    stackBb !== null
    && avgStackBb !== null
    && stackBb >= avgStackBb * 1.45
    && sessionMetrics.recentAggressionEma >= 0.45
  ) {
    states.push("bullying");
  }

  if (
    sessionMetrics.lastShowdownResult === "lost"
    && sessionMetrics.actionsSinceShowdown <= 6
    && sessionMetrics.recentCallEma >= 0.4
  ) {
    states.push("sticky_after_showdown");
  }

  return {
    vpip,
    pfr,
    aggression,
    foldToBet,
    riverFoldToBet,
    confidence,
    tags,
    states,
    playerName: input?.playerName || null,
    seatNo: input?.seatNo ?? null,
    stackBb,
    avgStackBb,
    playersConsidered: 1,
  };
}

export function combineOpponentProfiles(profiles: Array<OpponentProfile | null | undefined>): OpponentProfile {
  const usable = (profiles || []).filter(Boolean) as Exclude<OpponentProfile, null>[];
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];

  const weights = usable.map((profile) => clamp(profile.confidence || 0.4, 0.15, 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const tagWeights = new Map<OpponentTag, number>();
  const stateWeights = new Map<OpponentState, number>();

  usable.forEach((profile, index) => {
    const weight = weights[index];
    for (const tag of profile.tags || []) {
      tagWeights.set(tag, (tagWeights.get(tag) || 0) + weight);
    }
    for (const state of profile.states || []) {
      stateWeights.set(state, (stateWeights.get(state) || 0) + weight);
    }
  });

  let styleTag: OpponentTag | null = null;
  let bestStyleWeight = 0;
  for (const tag of STYLE_TAGS) {
    const weight = tagWeights.get(tag) || 0;
    if (weight > bestStyleWeight) {
      bestStyleWeight = weight;
      styleTag = tag;
    }
  }

  const tags: OpponentTag[] = [];
  if (styleTag && bestStyleWeight >= totalWeight * 0.34) tags.push(styleTag);
  for (const [tag, weight] of tagWeights.entries()) {
    if (STYLE_TAGS.includes(tag)) continue;
    if (weight >= totalWeight * 0.28) tags.push(tag);
  }

  const states = Array.from(stateWeights.entries())
    .filter(([, weight]) => weight >= totalWeight * 0.22)
    .sort((a, b) => b[1] - a[1])
    .map(([state]) => state);

  return {
    vpip: weightedAverage(usable.map((profile) => profile.vpip), weights, 0.28),
    pfr: weightedAverage(usable.map((profile) => profile.pfr), weights, 0.16),
    aggression: weightedAverage(usable.map((profile) => profile.aggression), weights, 1),
    foldToBet: weightedAverage(usable.map((profile) => profile.foldToBet), weights, 0.46),
    riverFoldToBet: weightedAverage(usable.map((profile) => profile.riverFoldToBet), weights, 0.46),
    confidence: clamp(weightedAverage(usable.map((profile) => profile.confidence), weights, 0.45), 0.16, 0.98),
    tags,
    states,
    stackBb: weightedAverage(
      usable.map((profile) => profile.stackBb ?? 0),
      usable.map((profile, index) => profile.stackBb == null ? 0 : weights[index]),
      0
    ) || null,
    avgStackBb: weightedAverage(
      usable.map((profile) => profile.avgStackBb ?? 0),
      usable.map((profile, index) => profile.avgStackBb == null ? 0 : weights[index]),
      0
    ) || null,
    playersConsidered: usable.length,
  };
}

const RANK_VAL: Record<string, number> = {
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

function preflopStrength(hole1?: string, hole2?: string) {
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

function toParsedCard(token?: string | null) {
  if (!token || token.length < 2) return null;
  const rank = RANK_VAL[token[0].toUpperCase()];
  const suit = token[token.length - 1].toUpperCase();
  if (!rank || !["S", "H", "D", "C"].includes(suit)) return null;
  return { rank, suit };
}

function uniqueRanksWithWheel(cards: Array<{ rank: number; suit: string }>) {
  const ranks = Array.from(new Set(
    (cards || [])
      .map((card) => card?.rank)
      .filter((rank) => Number.isFinite(rank))
  )).sort((a, b) => a - b);
  if (ranks.includes(14)) ranks.unshift(1);
  return ranks;
}

function bestStraightDrawScore(cards: Array<{ rank: number; suit: string }>) {
  const ranks = uniqueRanksWithWheel(cards);
  if (ranks.length < 4) return 0;
  let best = 0;
  for (let start = 1; start <= 10; start += 1) {
    const window = [start, start + 1, start + 2, start + 3, start + 4];
    const hits = window.filter((rank) => ranks.includes(rank)).length;
    if (hits >= 4) {
      const edgeHits = [window[0], window[4]].filter((rank) => ranks.includes(rank)).length;
      best = Math.max(best, hits === 5 ? 0.18 : edgeHits === 2 ? 0.13 : 0.08);
    }
  }
  return best;
}

function drawPotential(holeCards: string[], boardCards: string[], classRank = 0) {
  if (!holeCards || holeCards.length < 2 || !boardCards || boardCards.length < 3 || classRank >= 4) {
    return 0;
  }

  const parsedHole = holeCards.map(toParsedCard).filter(Boolean) as Array<{ rank: number; suit: string }>;
  const parsedBoard = boardCards.map(toParsedCard).filter(Boolean) as Array<{ rank: number; suit: string }>;
  const cards = [...parsedHole, ...parsedBoard];
  if (cards.length < 5) return 0;

  const suitCounts = cards.reduce<Record<string, number>>((acc, card) => {
    acc[card.suit] = (acc[card.suit] || 0) + 1;
    return acc;
  }, {});

  let flushDraw = 0;
  for (const [suit, count] of Object.entries(suitCounts)) {
    const holeSuited = parsedHole.some((card) => card.suit === suit);
    if (!holeSuited) continue;
    if (count >= 4) flushDraw = Math.max(flushDraw, 0.16);
    else if (parsedBoard.length === 3 && count === 3 && parsedHole.filter((card) => card.suit === suit).length === 2) {
      flushDraw = Math.max(flushDraw, 0.05);
    }
  }

  const straightDraw = bestStraightDrawScore(cards);
  return Math.min(0.24, flushDraw + straightDraw);
}

function pairBonus(holeCards: string[], boardCards: string[], result: ReturnType<typeof describeSevenCardHand>) {
  if (!result || result.classRank == null || result.classRank >= 4) return 0;
  const parsedHole = holeCards.map(toParsedCard).filter(Boolean) as Array<{ rank: number; suit: string }>;
  const parsedBoard = boardCards.map(toParsedCard).filter(Boolean) as Array<{ rank: number; suit: string }>;
  if (parsedHole.length < 2 || parsedBoard.length < 3) return 0;

  const holeRanks = parsedHole.map((card) => card.rank).sort((a, b) => b - a);
  const boardRanks = parsedBoard.map((card) => card.rank).sort((a, b) => b - a);
  const pairRank = Number(result.tuple?.[1] || 0);
  if (!pairRank) return 0;

  const holeHasPairRank = holeRanks.includes(pairRank);
  const highestBoard = boardRanks[0] || 0;
  const secondBoard = boardRanks[1] || highestBoard;

  if (result.classRank === 1) {
    if (holeRanks[0] === holeRanks[1] && pairRank > highestBoard) return 0.16;
    if (holeHasPairRank && pairRank >= highestBoard) return 0.13;
    if (holeHasPairRank && pairRank >= secondBoard) return 0.08;
    if (!holeHasPairRank) return -0.05;
  }

  if (result.classRank === 2) {
    const highPair = Number(result.tuple?.[1] || 0);
    const lowPair = Number(result.tuple?.[2] || 0);
    if (holeRanks.includes(highPair) && holeRanks.includes(lowPair)) return 0.12;
    if (holeRanks.includes(highPair) || holeRanks.includes(lowPair)) return 0.07;
  }

  if (result.classRank === 3 && holeHasPairRank) return 0.08;
  return 0;
}

function analyzePostflopHand(holeCards: string[], boardCards: string[]) {
  if (!holeCards || holeCards.length < 2 || !boardCards || boardCards.length < 3) {
    return { strength: 0.3, drawStrength: 0, classRank: null as number | null };
  }
  try {
    const allCards = [...holeCards, ...boardCards];
    const result = describeSevenCardHand(allCards);
    if (result.classRank == null) return { strength: 0.3, drawStrength: 0, classRank: null };
    const base = result.classRank / 8;
    const kicker = (result.tuple[1] || 7) / 14;
    const drawStrength = drawPotential(holeCards, boardCards, result.classRank);
    const pairEdge = pairBonus(holeCards, boardCards, result);
    const strength = Math.min(1.0, Math.max(0.0, base * 0.72 + kicker * 0.18 + drawStrength + pairEdge));
    return { strength, drawStrength, classRank: result.classRank };
  } catch {
    return { strength: 0.3, drawStrength: 0, classRank: null as number | null };
  }
}

function rand(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

function coinFlip(probability: number) {
  return Math.random() < probability;
}

function opponentAdjustments(opProfile: OpponentProfile) {
  if (!opProfile) return { bluffMod: 0, foldMod: 0, betMod: 0, callMod: 0 };

  let bluffMod = 0;
  let foldMod = 0;
  let betMod = 0;
  let callMod = 0;
  const confidenceScale = clamp(opProfile.confidence || 0.45, 0.2, 1);
  const hasTag = (tag: OpponentTag) => (opProfile.tags || []).includes(tag);
  const hasState = (state: OpponentState) => (opProfile.states || []).includes(state);

  if (opProfile.vpip > 0.5) {
    bluffMod -= 0.04 * confidenceScale;
    betMod += 0.05 * confidenceScale;
  } else if (opProfile.vpip < 0.25) {
    bluffMod += 0.06 * confidenceScale;
    foldMod -= 0.05 * confidenceScale;
  }

  if (opProfile.foldToBet > 0.6) {
    bluffMod += 0.08 * confidenceScale;
  } else if (opProfile.foldToBet < 0.3) {
    bluffMod -= 0.04 * confidenceScale;
    betMod += 0.04 * confidenceScale;
  }

  if (opProfile.aggression < 0.8) {
    betMod += 0.03 * confidenceScale;
  }

  if (hasTag("nit")) {
    bluffMod += 0.06 * confidenceScale;
    foldMod -= 0.04 * confidenceScale;
  }
  if (hasTag("tag")) {
    bluffMod -= 0.01 * confidenceScale;
    betMod += 0.02 * confidenceScale;
  }
  if (hasTag("lag")) {
    bluffMod -= 0.06 * confidenceScale;
    foldMod -= 0.06 * confidenceScale;
    callMod += 0.08 * confidenceScale;
  }
  if (hasTag("station")) {
    bluffMod -= 0.09 * confidenceScale;
    betMod += 0.08 * confidenceScale;
    callMod -= 0.05 * confidenceScale;
  }
  if (hasTag("trapper")) {
    bluffMod -= 0.05 * confidenceScale;
    foldMod += 0.02 * confidenceScale;
  }
  if (hasTag("bluff-heavy")) {
    bluffMod -= 0.05 * confidenceScale;
    foldMod -= 0.08 * confidenceScale;
    callMod += 0.1 * confidenceScale;
  }
  if (hasTag("river-overfolder")) {
    bluffMod += 0.07 * confidenceScale;
  }

  if (hasState("tilting")) {
    bluffMod -= 0.05 * confidenceScale;
    betMod += 0.08 * confidenceScale;
    callMod += 0.05 * confidenceScale;
  }
  if (hasState("protecting_stack")) {
    bluffMod += 0.05 * confidenceScale;
    betMod += 0.03 * confidenceScale;
  }
  if (hasState("bullying")) {
    bluffMod -= 0.04 * confidenceScale;
    foldMod -= 0.04 * confidenceScale;
    callMod += 0.06 * confidenceScale;
  }
  if (hasState("sticky_after_showdown")) {
    bluffMod -= 0.06 * confidenceScale;
    betMod += 0.05 * confidenceScale;
    callMod -= 0.03 * confidenceScale;
  }

  return {
    bluffMod: clamp(bluffMod, -0.18, 0.18),
    foldMod: clamp(foldMod, -0.14, 0.14),
    betMod: clamp(betMod, -0.16, 0.18),
    callMod: clamp(callMod, -0.14, 0.16)
  };
}

function positionMultiplier(seatNo: number, buttonSeat: number, totalSeats: number, activeSeatCount: number) {
  if (!buttonSeat || !totalSeats || activeSeatCount < 3) return 1.0;

  const dist = ((seatNo - buttonSeat + totalSeats) % totalSeats);
  const normalizedPos = dist / totalSeats;

  if (normalizedPos <= 0.15) return 1.15;
  if (normalizedPos <= 0.3) return 1.08;
  if (normalizedPos >= 0.7) return 0.88;
  if (normalizedPos >= 0.55) return 0.93;
  return 1.0;
}

const PROFILES: Record<BotPersonality, {
  preflopFoldBelow: number;
  postflopFoldBelow: number;
  raiseAbove: number;
  bluffRate: number;
  callRate: number;
  betSizeMin: number;
  betSizeMax: number;
  cbetRate: number;
  checkRaiseRate: number;
}> = {
  TAG: {
    preflopFoldBelow: 0.42,
    postflopFoldBelow: 0.25,
    raiseAbove: 0.65,
    bluffRate: 0.05,
    callRate: 0.7,
    betSizeMin: 0.5,
    betSizeMax: 0.8,
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
    cbetRate: 0.75,
    checkRaiseRate: 0.10,
  },
  Rock: {
    preflopFoldBelow: 0.52,
    postflopFoldBelow: 0.35,
    raiseAbove: 0.75,
    bluffRate: 0.02,
    callRate: 0.85,
    betSizeMin: 0.4,
    betSizeMax: 0.6,
    cbetRate: 0.55,
    checkRaiseRate: 0.03,
  },
  Station: {
    preflopFoldBelow: 0.2,
    postflopFoldBelow: 0.15,
    raiseAbove: 0.8,
    bluffRate: 0.03,
    callRate: 0.92,
    betSizeMin: 0.3,
    betSizeMax: 0.5,
    cbetRate: 0.45,
    checkRaiseRate: 0.02,
  },
};

export function decideBotAction({
  personality,
  holeCards,
  boardCards,
  pot,
  currentBet,
  streetContribution,
  stackEnd,
  bigBlind,
  street,
  seatNo,
  buttonSeat,
  totalSeats,
  activeSeatCount,
  wasAggressor,
  opponentProfile,
}: {
  personality: BotPersonality;
  holeCards: string[];
  boardCards: string[];
  pot: number;
  currentBet: number;
  streetContribution: number;
  stackEnd: number;
  bigBlind: number;
  street: string;
  seatNo: number;
  buttonSeat: number;
  totalSeats: number;
  activeSeatCount: number;
  wasAggressor: boolean;
  opponentProfile?: OpponentProfile;
}) {
  const profile = PROFILES[personality] || PROFILES.TAG;
  const toCall = Math.max(0, (currentBet || 0) - (streetContribution || 0));
  const stack = stackEnd || 0;
  const isPreflop = street === "preflop" || !boardCards || boardCards.length < 3;
  const isFlop = street === "flop";
  const postflop = isPreflop ? { strength: 0, drawStrength: 0, classRank: null } : analyzePostflopHand(holeCards, boardCards);

  if (stack <= 0) return { actionType: "check", amount: null as number | null };

  const rawStrength = isPreflop
    ? preflopStrength(holeCards?.[0], holeCards?.[1])
    : postflop.strength;
  const drawStrength = isPreflop ? 0 : postflop.drawStrength;
  const madeClassRank = isPreflop ? null : postflop.classRank;

  const posMult = positionMultiplier(seatNo || 0, buttonSeat || 0, totalSeats || 6, activeSeatCount || 2);
  const opAdj = opponentAdjustments(opponentProfile || null);
  const noise = rand(-0.05, 0.05);
  const effectiveStrength = Math.min(1.0, Math.max(0.0, rawStrength * posMult + noise));

  const adjustedBluffRate = Math.max(0, Math.min(0.3, profile.bluffRate + opAdj.bluffMod));
  const adjustedFoldThreshold = isPreflop
    ? Math.max(0.1, profile.preflopFoldBelow + opAdj.foldMod)
    : Math.max(0.1, profile.postflopFoldBelow + opAdj.foldMod);
  const adjustedRaiseAbove = Math.max(0.3, profile.raiseAbove - opAdj.betMod);
  const adjustedCallRate = clamp(profile.callRate + opAdj.callMod, 0.48, 0.98);
  const strongDraw = !isPreflop && drawStrength >= 0.12;
  const premiumMadeHand = !isPreflop && (madeClassRank || 0) >= 2;

  if (isFlop && wasAggressor && currentBet === 0 && toCall === 0) {
    const cbetRate = Math.min(
      0.92,
      profile.cbetRate + (strongDraw ? 0.08 : 0) + (premiumMadeHand ? 0.06 : 0) + opAdj.bluffMod * 0.35 + opAdj.betMod * 0.2
    );
    if (coinFlip(cbetRate)) {
      const cbetSize = Math.max(Math.round(pot * rand(0.4, 0.7)), bigBlind || 2);
      if (cbetSize < stack) {
        return { actionType: "bet", amount: cbetSize };
      }
    }
  }

  if (!isPreflop && effectiveStrength >= 0.7 && currentBet === 0 && toCall === 0) {
    if (coinFlip(profile.checkRaiseRate)) {
      return { actionType: "check", amount: null as number | null };
    }
  }

  if (strongDraw && toCall > 0) {
    const potOdds = toCall / Math.max(1, pot + toCall);
    const affordableDraw = toCall <= stack * 0.34 || potOdds <= Math.min(0.42, effectiveStrength + drawStrength * 0.55);
    if (affordableDraw) {
      if (coinFlip(Math.min(0.36, adjustedBluffRate + 0.14)) && stack > toCall * 2.5) {
        const raiseSize = Math.max(Math.round(pot * rand(0.45, 0.8)), bigBlind || 2);
        const raiseTarget = (currentBet || 0) + raiseSize;
        if (raiseTarget <= (streetContribution || 0) + stack) {
          return { actionType: "raise", amount: raiseTarget };
        }
      }
      return { actionType: "call", amount: null as number | null };
    }
  }

  if (effectiveStrength < adjustedFoldThreshold && toCall > 0) {
    if (coinFlip(adjustedBluffRate) && stack > toCall * 2) {
      const bluffSize = Math.round(pot * rand(0.5, 0.8));
      const raiseTarget = Math.max((currentBet || 0) + (bigBlind || 2), (currentBet || 0) + bluffSize);
      if (raiseTarget <= (streetContribution || 0) + stack) {
        return { actionType: currentBet > 0 ? "raise" : "bet", amount: Math.min(raiseTarget, (streetContribution || 0) + stack) };
      }
    }
    return toCall > 0 ? { actionType: "fold", amount: null as number | null } : { actionType: "check", amount: null as number | null };
  }

  if (effectiveStrength >= adjustedRaiseAbove) {
    const sizeFrac = rand(profile.betSizeMin, profile.betSizeMax);
    if (currentBet > 0) {
      const raiseSize = Math.max(Math.round(pot * sizeFrac), bigBlind || 2);
      const raiseTarget = (currentBet || 0) + raiseSize;
      if (raiseTarget > (streetContribution || 0) + stack) {
        return { actionType: "all_in", amount: null as number | null };
      }
      return { actionType: "raise", amount: raiseTarget };
    }
    const betSize = Math.max(Math.round(pot * sizeFrac), bigBlind || 2);
    if (betSize >= stack) {
      return { actionType: "all_in", amount: null as number | null };
    }
    return { actionType: "bet", amount: betSize };
  }

  if (toCall > 0) {
    if (toCall > stack) {
      return coinFlip(adjustedCallRate) ? { actionType: "all_in", amount: null as number | null } : { actionType: "fold", amount: null as number | null };
    }

    const potOdds = toCall / Math.max(1, pot + toCall);
    if (effectiveStrength < potOdds * 1.1) {
      return coinFlip(0.2) ? { actionType: "call", amount: null as number | null } : { actionType: "fold", amount: null as number | null };
    }

    return coinFlip(adjustedCallRate) ? { actionType: "call", amount: null as number | null } : { actionType: "fold", amount: null as number | null };
  }

  if (strongDraw && coinFlip(0.42)) {
    const semibluffSize = Math.max(Math.round(pot * rand(0.38, 0.62)), bigBlind || 2);
    if (semibluffSize < stack) {
      return { actionType: "bet", amount: semibluffSize };
    }
  }

  if (effectiveStrength > adjustedFoldThreshold + 0.15 && coinFlip(0.3)) {
    const betSize = Math.max(Math.round(pot * rand(0.3, 0.5)), bigBlind || 2);
    if (betSize < stack) {
      return { actionType: "bet", amount: betSize };
    }
  }

  return { actionType: "check", amount: null as number | null };
}

export function botThinkTimeMs({
  street = "preflop",
  toCall = 0,
  pot = 0,
  currentBet = 0,
  activeSeatCount = 2,
}: {
  street?: string;
  toCall?: number;
  pot?: number;
  currentBet?: number;
  activeSeatCount?: number;
} = {}) {
  const baseByStreet: Record<string, number> = {
    preflop: 1650,
    flop: 2350,
    turn: 2750,
    river: 3200,
  };
  let delay = baseByStreet[street] || 2000;
  if (toCall > 0) delay += 320;
  if (currentBet > 0) delay += 180;
  if (pot >= 40) delay += 260;
  if (pot >= 120) delay += 320;
  if (activeSeatCount <= 3) delay += 140;
  delay += Math.floor(Math.random() * 850);
  return delay;
}
