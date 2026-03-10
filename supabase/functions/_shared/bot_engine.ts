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
const READ_STYLE: Record<BotPersonality, {
  bluffGain: number;
  valueGain: number;
  cautionGain: number;
  callGain: number;
  pressureGain: number;
}> = {
  TAG: {
    bluffGain: 0.95,
    valueGain: 1.05,
    cautionGain: 1.0,
    callGain: 0.95,
    pressureGain: 1.0,
  },
  LAG: {
    bluffGain: 1.35,
    valueGain: 1.1,
    cautionGain: 0.72,
    callGain: 1.05,
    pressureGain: 1.25,
  },
  Rock: {
    bluffGain: 0.55,
    valueGain: 0.95,
    cautionGain: 1.35,
    callGain: 0.8,
    pressureGain: 0.7,
  },
  Station: {
    bluffGain: 0.4,
    valueGain: 0.82,
    cautionGain: 0.88,
    callGain: 1.35,
    pressureGain: 0.6,
  },
};

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

type PositionBand =
  | "heads_up_button"
  | "heads_up_big_blind"
  | "button"
  | "small_blind"
  | "big_blind"
  | "cutoff"
  | "middle"
  | "early";
type PreflopBucket = "unopened" | "limped" | "vs_open" | "vs_3bet" | "vs_4bet_plus";
type PreflopTier = "premium" | "strong" | "value" | "speculative" | "marginal" | "trash";
type PreflopFeatures = {
  highRank: number;
  lowRank: number;
  suited: boolean;
  paired: boolean;
  gap: number;
  connected: boolean;
  aceHigh: boolean;
  broadwayCount: number;
  pairRank: number | null;
  tier: PreflopTier;
  tierScore: number;
};

function stackInBigBlinds(stack: number, bigBlind: number) {
  return stack / Math.max(1, Number(bigBlind || 2));
}

function roundBbAmount(targetBb: number, bigBlind: number) {
  return Math.max(
    Math.max(1, Number(bigBlind || 2)),
    Math.round(Math.max(0, targetBb) * 2) / 2 * Math.max(1, Number(bigBlind || 2))
  );
}

function preflopFeatures(hole1?: string, hole2?: string): PreflopFeatures {
  if (!hole1 || !hole2 || hole1.length < 2 || hole2.length < 2) {
    return {
      highRank: 0,
      lowRank: 0,
      suited: false,
      paired: false,
      gap: 12,
      connected: false,
      aceHigh: false,
      broadwayCount: 0,
      pairRank: null,
      tier: "trash",
      tierScore: 0,
    };
  }

  const r1 = RANK_VAL[hole1[0].toUpperCase()] || 2;
  const r2 = RANK_VAL[hole2[0].toUpperCase()] || 2;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const suited = hole1[1].toLowerCase() === hole2[1].toLowerCase();
  const paired = r1 === r2;
  const gap = hi - lo;
  const connected = gap <= 1;
  const broadwayCount = (hi >= 10 ? 1 : 0) + (lo >= 10 ? 1 : 0);
  const aceHigh = hi === 14;

  let tier: PreflopTier = "trash";
  if (paired && hi >= 11) tier = "premium";
  else if ((hi === 14 && lo === 13) || (suited && hi === 14 && lo === 12)) tier = "premium";
  else if ((paired && hi >= 9) || (hi === 14 && lo >= 12) || (suited && hi >= 13 && lo >= 11)) tier = "strong";
  else if (
    (paired && hi >= 6)
    || (suited && aceHigh)
    || (suited && broadwayCount === 2)
    || (broadwayCount === 2 && connected)
    || (suited && connected && hi >= 9)
  ) tier = "value";
  else if (
    paired
    || suited
    || (aceHigh && lo >= 8)
    || (broadwayCount === 2)
    || (connected && hi >= 8)
  ) tier = "speculative";
  else if ((hi >= 11 && lo >= 8) || (connected && hi >= 6)) tier = "marginal";

  const tierScoreMap: Record<PreflopTier, number> = {
    premium: 5,
    strong: 4,
    value: 3,
    speculative: 2,
    marginal: 1,
    trash: 0,
  };

  return {
    highRank: hi,
    lowRank: lo,
    suited,
    paired,
    gap,
    connected,
    aceHigh,
    broadwayCount,
    pairRank: paired ? hi : null,
    tier,
    tierScore: tierScoreMap[tier],
  };
}

function positionBand(
  seatNo: number,
  buttonSeat: number,
  totalSeats: number,
  activeSeatCount: number
): PositionBand {
  if (!buttonSeat || !totalSeats) return activeSeatCount <= 2 ? "heads_up_big_blind" : "middle";
  const dist = ((seatNo - buttonSeat + totalSeats) % totalSeats);
  if (activeSeatCount <= 2) return dist === 0 ? "heads_up_button" : "heads_up_big_blind";
  if (dist === 0) return "button";
  if (dist === 1) return "small_blind";
  if (dist === 2) return "big_blind";
  const normalized = dist / Math.max(1, totalSeats);
  if (normalized >= 0.72) return "early";
  if (normalized >= 0.48) return "middle";
  return "cutoff";
}

function isInPosition(position: PositionBand) {
  return position === "button" || position === "cutoff" || position === "heads_up_button";
}

function isBlindPosition(position: PositionBand) {
  return position === "small_blind" || position === "big_blind" || position === "heads_up_big_blind";
}

function classifyPreflopBucket(aggressionCount: number, limperCount: number): PreflopBucket {
  if (aggressionCount >= 3) return "vs_4bet_plus";
  if (aggressionCount === 2) return "vs_3bet";
  if (aggressionCount === 1) return "vs_open";
  if (limperCount > 0) return "limped";
  return "unopened";
}

const PREFLOP_STYLE: Record<BotPersonality, {
  openShift: number;
  flatShift: number;
  threeBetShift: number;
  jamShift: number;
  riskShift: number;
}> = {
  TAG: { openShift: 0, flatShift: 0, threeBetShift: 0, jamShift: 0, riskShift: 0 },
  LAG: { openShift: 0.5, flatShift: -0.2, threeBetShift: 0.45, jamShift: 0.12, riskShift: 0.08 },
  Rock: { openShift: -0.5, flatShift: -0.15, threeBetShift: -0.22, jamShift: -0.18, riskShift: -0.08 },
  Station: { openShift: -0.15, flatShift: 0.45, threeBetShift: -0.38, jamShift: -0.2, riskShift: -0.12 },
};

function preflopReadShift(opProfile: OpponentProfile | undefined | null, personality: BotPersonality) {
  if (!opProfile) return 0;
  let shift = 0;
  const style = READ_STYLE[personality] || READ_STYLE.TAG;
  if ((opProfile.tags || []).includes("nit")) shift += 0.24 * style.pressureGain;
  if ((opProfile.tags || []).includes("river-overfolder")) shift += 0.08 * style.bluffGain;
  if ((opProfile.tags || []).includes("station")) shift -= 0.14 * style.cautionGain;
  if ((opProfile.tags || []).includes("lag")) shift -= 0.12 * style.cautionGain;
  if ((opProfile.tags || []).includes("trapper")) shift -= 0.1 * style.cautionGain;
  if ((opProfile.tags || []).includes("bluff-heavy")) shift -= 0.06 * style.callGain;
  if ((opProfile.states || []).includes("protecting_stack")) shift += 0.1 * style.pressureGain;
  if ((opProfile.states || []).includes("bullying")) shift -= 0.05 * style.cautionGain;
  return clamp(shift, -0.3, 0.3);
}

function openThresholdByPosition(position: PositionBand) {
  switch (position) {
    case "heads_up_button": return 2.35;
    case "button": return 2.7;
    case "cutoff": return 3.1;
    case "small_blind": return 3.15;
    case "big_blind": return 3.05;
    case "heads_up_big_blind": return 2.7;
    case "middle": return 3.8;
    case "early":
    default:
      return 4.45;
  }
}

function humanOpenRaiseTargetBb({
  position,
  personality,
  limperCount,
  handTier,
}: {
  position: PositionBand;
  personality: BotPersonality;
  limperCount: number;
  handTier: PreflopTier;
}) {
  let base = position === "early"
    ? 2.8
    : position === "middle"
      ? 2.6
      : position === "small_blind"
        ? 3.15
        : position === "heads_up_button"
          ? 2.3
          : 2.4;
  if (personality === "LAG") base += 0.15;
  if (personality === "Rock") base -= 0.1;
  if (limperCount > 0) base = Math.min(6.4, 3.8 + limperCount + (handTier === "premium" ? 0.4 : 0));
  return clamp(base, 2.1, 6.4);
}

function humanThreeBetTargetBb({
  currentBetBb,
  inPosition,
  personality,
}: {
  currentBetBb: number;
  inPosition: boolean;
  personality: BotPersonality;
}) {
  const multiplier = inPosition
    ? (personality === "LAG" ? rand(2.9, 3.2) : rand(2.75, 3.05))
    : (personality === "Rock" ? rand(3.2, 3.45) : rand(3.3, 3.75));
  return currentBetBb * multiplier;
}

function humanFourBetTargetBb({
  currentBetBb,
  inPosition,
  personality,
  effectiveStackBb,
}: {
  currentBetBb: number;
  inPosition: boolean;
  personality: BotPersonality;
  effectiveStackBb: number;
}) {
  const baseMultiplier = inPosition
    ? (personality === "LAG" ? rand(2.15, 2.35) : rand(2.2, 2.45))
    : (personality === "Rock" ? rand(2.2, 2.35) : rand(2.25, 2.5));
  const deepStackCap = effectiveStackBb >= 80 ? 0.92 : 1;
  return currentBetBb * baseMultiplier * deepStackCap;
}

function maxPreflopCommitmentBb({
  tier,
  bucket,
  effectiveStackBb,
  personality,
}: {
  tier: PreflopTier;
  bucket: PreflopBucket;
  effectiveStackBb: number;
  personality: BotPersonality;
}) {
  const style = PREFLOP_STYLE[personality] || PREFLOP_STYLE.TAG;
  const baseByTier: Record<PreflopTier, number> = {
    premium: bucket === "vs_4bet_plus" ? 42 : bucket === "vs_3bet" ? 30 : 18,
    strong: bucket === "vs_3bet" ? 18 : 13,
    value: bucket === "vs_open" ? 9 : 7.5,
    speculative: bucket === "vs_open" ? 6.2 : 5,
    marginal: 4.2,
    trash: 2.5,
  };
  const personalityAdjust = style.riskShift * 7;
  return clamp(baseByTier[tier] + personalityAdjust, 2.5, effectiveStackBb);
}

function shouldJamPreflopByContext({
  tier,
  rawStrength,
  effectiveStackBb,
  bucket,
  currentBetBb,
  currentContributionBb,
  personality,
}: {
  tier: PreflopTier;
  rawStrength: number;
  effectiveStackBb: number;
  bucket: PreflopBucket;
  currentBetBb: number;
  currentContributionBb: number;
  personality: BotPersonality;
}) {
  const style = PREFLOP_STYLE[personality] || PREFLOP_STYLE.TAG;
  const committedRatio = effectiveStackBb > 0
    ? clamp((currentContributionBb + currentBetBb) / effectiveStackBb, 0, 1)
    : 0;
  if (effectiveStackBb <= 8.5) return rawStrength >= 0.62;
  if (effectiveStackBb <= 12) return tier === "premium" || (tier === "strong" && rawStrength >= 0.76 + style.jamShift * 0.2);
  if (bucket === "vs_3bet" && effectiveStackBb <= 22) {
    return tier === "premium" || (tier === "strong" && personality === "LAG" && rawStrength >= 0.84);
  }
  if (bucket === "vs_4bet_plus" && effectiveStackBb <= 30) {
    return tier === "premium" && rawStrength >= 0.86 + style.jamShift * 0.08;
  }
  if (tier === "premium" && committedRatio >= 0.38 && effectiveStackBb <= 40) return true;
  return false;
}

function canOpenLimp({
  position,
  tier,
  personality,
}: {
  position: PositionBand;
  tier: PreflopTier;
  personality: BotPersonality;
}) {
  if (!(position === "small_blind" || position === "heads_up_button")) return false;
  if (tier === "speculative" && (personality === "Station" || personality === "LAG")) return true;
  return tier === "marginal" && personality === "Station";
}

function canFlatOpen({
  features,
  tier,
  position,
  toCallBb,
  effectiveStackBb,
  activeSeatCount,
  personality,
}: {
  features: PreflopFeatures;
  tier: PreflopTier;
  position: PositionBand;
  toCallBb: number;
  effectiveStackBb: number;
  activeSeatCount: number;
  personality: BotPersonality;
}) {
  const inPosition = isInPosition(position);
  const inBlind = isBlindPosition(position);
  if (tier === "premium") return false;
  if (tier === "strong") return toCallBb <= 6.5 || inPosition || inBlind;
  if (tier === "value") {
    if (features.paired && effectiveStackBb >= 20) return toCallBb <= 6.5;
    if (features.suited && inPosition) return toCallBb <= 5.5;
    return (inPosition || inBlind) && toCallBb <= 4.5;
  }
  if (tier === "speculative") {
    if (features.paired) return inPosition && effectiveStackBb >= 35 && toCallBb <= 5.5;
    if (features.suited && features.connected) return inPosition && effectiveStackBb >= 32 && toCallBb <= 4.2;
    if (position === "heads_up_big_blind" || position === "big_blind") return toCallBb <= 2.5 && activeSeatCount <= 3;
    return personality === "Station" && inPosition && toCallBb <= 3.5;
  }
  if (tier === "marginal") {
    return (position === "big_blind" || position === "heads_up_big_blind") && toCallBb <= 2.0;
  }
  return false;
}

function canContinueVsThreeBet({
  features,
  tier,
  position,
  toCallBb,
  effectiveStackBb,
  personality,
}: {
  features: PreflopFeatures;
  tier: PreflopTier;
  position: PositionBand;
  toCallBb: number;
  effectiveStackBb: number;
  personality: BotPersonality;
}) {
  const inPosition = isInPosition(position);
  if (tier === "premium") return true;
  if (tier === "strong") {
    if (features.paired && features.highRank >= 10) return toCallBb <= 11;
    return (inPosition && toCallBb <= 9.5) || (personality === "Station" && toCallBb <= 8.5);
  }
  if (tier === "value") {
    if (features.paired) return inPosition && effectiveStackBb >= 42 && toCallBb <= 8;
    return inPosition && features.suited && effectiveStackBb >= 38 && toCallBb <= 7;
  }
  if (tier === "speculative") {
    return features.paired && inPosition && effectiveStackBb >= 55 && toCallBb <= 6.5;
  }
  return false;
}

function stackToPotRatio(stack: number, pot: number, toCall: number) {
  return Math.max(0, stack - toCall) / Math.max(1, pot + toCall);
}

function shouldStackOffPostflop({
  madeClassRank,
  effectiveStrength,
  drawStrength,
  spr,
}: {
  madeClassRank: number | null;
  effectiveStrength: number;
  drawStrength: number;
  spr: number;
}) {
  if ((madeClassRank || 0) >= 6) return true;
  if ((madeClassRank || 0) >= 5) return spr <= 4.5 || effectiveStrength >= 0.9;
  if ((madeClassRank || 0) >= 3) return spr <= 2.2 || effectiveStrength >= 0.85;
  if ((madeClassRank || 0) === 2) return spr <= 1.25 && effectiveStrength >= 0.75;
  if (drawStrength >= 0.16) return spr <= 1.0 && effectiveStrength >= 0.62;
  return false;
}

function postflopRiskFraction({
  street,
  madeClassRank,
  effectiveStrength,
  drawStrength,
  spr,
  personality,
}: {
  street: string;
  madeClassRank: number | null;
  effectiveStrength: number;
  drawStrength: number;
  spr: number;
  personality: BotPersonality;
}) {
  let base = 0.18;
  if ((madeClassRank || 0) >= 6) base = 0.95;
  else if ((madeClassRank || 0) >= 5) base = 0.78;
  else if ((madeClassRank || 0) >= 3) base = 0.58;
  else if ((madeClassRank || 0) === 2) base = 0.46;
  else if ((madeClassRank || 0) === 1) base = effectiveStrength >= 0.78 ? 0.36 : 0.27;
  else if (drawStrength >= 0.14) base = 0.29;

  if (street === "turn") base += 0.04;
  if (street === "river") base += 0.08;
  if (spr <= 2) base += 0.12;
  if (spr <= 1.1) base += 0.1;
  if (personality === "LAG") base += 0.04;
  if (personality === "Rock") base -= 0.04;
  if (personality === "Station") base -= 0.06;
  return clamp(base, 0.16, 1);
}

function postflopSizeFraction({
  madeClassRank,
  effectiveStrength,
  drawStrength,
  personality,
  bluff = false,
}: {
  madeClassRank: number | null;
  effectiveStrength: number;
  drawStrength: number;
  personality: BotPersonality;
  bluff?: boolean;
}) {
  if (bluff) {
    if (drawStrength >= 0.12) return clamp(rand(0.42, 0.62) + (personality === "LAG" ? 0.04 : 0), 0.38, 0.68);
    return clamp(rand(0.33, 0.5) + (personality === "LAG" ? 0.03 : 0), 0.3, 0.58);
  }
  if ((madeClassRank || 0) >= 6) return clamp(rand(0.62, 0.86), 0.55, 0.9);
  if ((madeClassRank || 0) >= 5) return clamp(rand(0.55, 0.78), 0.5, 0.82);
  if ((madeClassRank || 0) >= 3) return clamp(rand(0.46, 0.7), 0.42, 0.74);
  if ((madeClassRank || 0) === 2) return clamp(rand(0.42, 0.62), 0.38, 0.66);
  if ((madeClassRank || 0) === 1) return effectiveStrength >= 0.78
    ? clamp(rand(0.38, 0.55), 0.34, 0.58)
    : clamp(rand(0.28, 0.44), 0.25, 0.48);
  if (drawStrength >= 0.12) return clamp(rand(0.42, 0.58), 0.38, 0.62);
  return clamp(rand(0.3, 0.44), 0.28, 0.48);
}

function capTargetByRisk({
  desiredTarget,
  streetContribution,
  stack,
  riskFraction,
}: {
  desiredTarget: number;
  streetContribution: number;
  stack: number;
  riskFraction: number;
}) {
  const maxAdditional = Math.max(0, stack * riskFraction);
  const maxTarget = streetContribution + maxAdditional;
  return Math.min(desiredTarget, streetContribution + stack, maxTarget);
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

function opponentAdjustments(opProfile: OpponentProfile, personality: BotPersonality) {
  if (!opProfile) return { bluffMod: 0, foldMod: 0, betMod: 0, callMod: 0 };

  let bluffMod = 0;
  let foldMod = 0;
  let betMod = 0;
  let callMod = 0;
  const confidenceScale = clamp(opProfile.confidence || 0.45, 0.2, 1);
  const style = READ_STYLE[personality] || READ_STYLE.TAG;
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
    bluffMod += 0.06 * confidenceScale * style.bluffGain;
    foldMod -= 0.04 * confidenceScale * style.pressureGain;
    if (personality === "LAG") betMod += 0.03 * confidenceScale;
    if (personality === "Rock") callMod -= 0.02 * confidenceScale;
  }
  if (hasTag("tag")) {
    bluffMod -= 0.01 * confidenceScale * style.cautionGain;
    betMod += 0.02 * confidenceScale * style.valueGain;
  }
  if (hasTag("lag")) {
    bluffMod -= 0.06 * confidenceScale * style.cautionGain;
    foldMod -= 0.06 * confidenceScale * style.callGain;
    callMod += 0.08 * confidenceScale * style.callGain;
    if (personality === "LAG") betMod += 0.04 * confidenceScale;
    if (personality === "Rock") betMod -= 0.03 * confidenceScale;
  }
  if (hasTag("station")) {
    bluffMod -= 0.09 * confidenceScale * (1.2 - style.bluffGain * 0.4);
    betMod += 0.08 * confidenceScale * style.valueGain;
    callMod -= 0.05 * confidenceScale * style.cautionGain;
    if (personality === "LAG") betMod += 0.04 * confidenceScale;
    if (personality === "Station") foldMod -= 0.02 * confidenceScale;
  }
  if (hasTag("trapper")) {
    bluffMod -= 0.05 * confidenceScale * style.cautionGain;
    foldMod += 0.02 * confidenceScale * style.cautionGain;
    if (personality === "Rock") bluffMod -= 0.03 * confidenceScale;
    if (personality === "LAG") callMod += 0.02 * confidenceScale;
  }
  if (hasTag("bluff-heavy")) {
    bluffMod -= 0.05 * confidenceScale * style.cautionGain;
    foldMod -= 0.08 * confidenceScale * style.callGain;
    callMod += 0.1 * confidenceScale * style.callGain;
    if (personality === "LAG") betMod += 0.03 * confidenceScale;
    if (personality === "Rock") callMod -= 0.03 * confidenceScale;
  }
  if (hasTag("river-overfolder")) {
    bluffMod += 0.07 * confidenceScale * style.bluffGain;
    if (personality === "LAG") betMod += 0.02 * confidenceScale;
  }

  if (hasState("tilting")) {
    bluffMod -= 0.05 * confidenceScale * style.cautionGain;
    betMod += 0.08 * confidenceScale * style.valueGain;
    callMod += 0.05 * confidenceScale * style.callGain;
    if (personality === "Rock") foldMod += 0.03 * confidenceScale;
  }
  if (hasState("protecting_stack")) {
    bluffMod += 0.05 * confidenceScale * style.pressureGain;
    betMod += 0.03 * confidenceScale * style.pressureGain;
    if (personality === "LAG") bluffMod += 0.03 * confidenceScale;
  }
  if (hasState("bullying")) {
    bluffMod -= 0.04 * confidenceScale * style.cautionGain;
    foldMod -= 0.04 * confidenceScale * style.callGain;
    callMod += 0.06 * confidenceScale * style.callGain;
    if (personality === "Rock") betMod -= 0.02 * confidenceScale;
    if (personality === "LAG") callMod += 0.03 * confidenceScale;
  }
  if (hasState("sticky_after_showdown")) {
    bluffMod -= 0.06 * confidenceScale * style.cautionGain;
    betMod += 0.05 * confidenceScale * style.valueGain;
    callMod -= 0.03 * confidenceScale * style.cautionGain;
    if (personality === "Station") callMod += 0.03 * confidenceScale;
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

export function resolveDynamicBotPersonality({
  basePersonality,
  stackBb,
  effectiveStackBb,
  startingStackBb = null,
  averageOpponentStackBb = null,
  opponentProfile = null,
  activeSeatCount = 2,
}: {
  basePersonality: BotPersonality;
  stackBb: number;
  effectiveStackBb: number;
  startingStackBb?: number | null;
  averageOpponentStackBb?: number | null;
  opponentProfile?: OpponentProfile | null;
  activeSeatCount?: number;
}) {
  const liveStackBb = Math.max(0, Number(stackBb || 0));
  const effectiveDepthBb = Math.max(0, Number(effectiveStackBb || liveStackBb));
  const baselineStackBb = Number(startingStackBb || 0) > 0 ? Number(startingStackBb || 0) : null;
  const tableAverageBb = Number(averageOpponentStackBb || 0) > 0 ? Number(averageOpponentStackBb || 0) : null;
  const stackGrowthRatio = baselineStackBb ? liveStackBb / baselineStackBb : 1;
  const tableLeadRatio = tableAverageBb ? liveStackBb / tableAverageBb : 1;
  const tags = new Set(opponentProfile?.tags || []);
  const states = new Set(opponentProfile?.states || []);

  const playingBigStack = (
    (baselineStackBb !== null && stackGrowthRatio >= 1.45 && liveStackBb >= Math.max(24, baselineStackBb * 0.8)) ||
    (tableAverageBb !== null && tableLeadRatio >= 1.33 && liveStackBb >= 28)
  );
  const underPressure = (
    effectiveDepthBb <= 16 ||
    (baselineStackBb !== null && stackGrowthRatio <= 0.58) ||
    (tableAverageBb !== null && tableLeadRatio <= 0.72)
  );

  let next = basePersonality;
  if (underPressure) {
    if (basePersonality === "LAG") next = "TAG";
    else if (basePersonality === "TAG") next = "Rock";
    else if (basePersonality === "Station") next = "TAG";
    else next = "Rock";
  } else if (playingBigStack) {
    if (basePersonality === "Rock") next = "TAG";
    else if (basePersonality === "TAG") next = "LAG";
    else if (basePersonality === "Station") next = "TAG";
    else next = "LAG";
  }

  // Big stacks should lean toward value extraction, not mindless blasting.
  if ((tags.has("station") || tags.has("trapper")) && next === "LAG") next = "TAG";
  if (tags.has("nit") && playingBigStack && next === "TAG" && activeSeatCount >= 4) next = "LAG";
  if (states.has("protecting_stack") && playingBigStack && next === "TAG") next = "LAG";
  if (states.has("bullying") && underPressure && next === "LAG") next = "TAG";

  return next;
}

function decideStructuredPreflopAction({
  personality,
  holeCards,
  currentBet,
  streetContribution,
  stack,
  bigBlind,
  seatNo,
  buttonSeat,
  totalSeats,
  activeSeatCount,
  rawStrength,
  effectiveStrength,
  opponentProfile,
  streetAggressionCount = 0,
  preflopLimperCount = 0,
  effectiveStackBbHint = null,
}: {
  personality: BotPersonality;
  holeCards: string[];
  currentBet: number;
  streetContribution: number;
  stack: number;
  bigBlind: number;
  seatNo: number;
  buttonSeat: number;
  totalSeats: number;
  activeSeatCount: number;
  rawStrength: number;
  effectiveStrength: number;
  opponentProfile?: OpponentProfile;
  streetAggressionCount?: number;
  preflopLimperCount?: number;
  effectiveStackBbHint?: number | null;
}) {
  const blind = Math.max(1, Number(bigBlind || 2));
  const toCall = Math.max(0, Number(currentBet || 0) - Number(streetContribution || 0));
  const toCallBb = toCall / blind;
  const currentBetBb = Number(currentBet || 0) / blind;
  const currentContributionBb = Number(streetContribution || 0) / blind;
  const stackBb = stackInBigBlinds(stack, blind);
  const effectiveStackBb = Math.max(
    1,
    Math.min(stackBb + currentContributionBb, Number(effectiveStackBbHint || (stackBb + currentContributionBb)))
  );
  const absoluteCapBb = currentContributionBb + stackBb;
  const position = positionBand(seatNo || 0, buttonSeat || 0, totalSeats || 6, activeSeatCount || 2);
  const inPosition = isInPosition(position);
  const features = preflopFeatures(holeCards?.[0], holeCards?.[1]);
  const bucket = classifyPreflopBucket(Number(streetAggressionCount || 0), Number(preflopLimperCount || 0));
  const style = PREFLOP_STYLE[personality] || PREFLOP_STYLE.TAG;
  const readShift = preflopReadShift(opponentProfile || null, personality);
  const handScore = features.tierScore + rawStrength * 0.9;

  const raiseTargetAmount = (targetBb: number) => {
    const cappedCommitmentBb = maxPreflopCommitmentBb({
      tier: features.tier,
      bucket,
      effectiveStackBb,
      personality,
    });
    const cappedTargetBb = Math.min(targetBb, cappedCommitmentBb, absoluteCapBb);
    const minimumReRaiseBb = bucket === "vs_open" ? currentBetBb * 2.45 : currentBetBb * 2.08;
    if ((bucket === "vs_open" || bucket === "vs_3bet" || bucket === "vs_4bet_plus") && cappedTargetBb < minimumReRaiseBb) {
      return null;
    }
    return roundBbAmount(cappedTargetBb, blind);
  };

  const jamNow = shouldJamPreflopByContext({
    tier: features.tier,
    rawStrength,
    effectiveStackBb,
    bucket,
    currentBetBb,
    currentContributionBb,
    personality,
  });

  if (bucket === "unopened") {
    if (toCall <= 0) return { actionType: "check", amount: null as number | null };
    const openThreshold = openThresholdByPosition(position) - style.openShift - readShift;
    if (handScore >= openThreshold) {
      const targetAmount = raiseTargetAmount(
        humanOpenRaiseTargetBb({
          position,
          personality,
          limperCount: 0,
          handTier: features.tier,
        })
      );
      if (targetAmount != null) return { actionType: "raise", amount: targetAmount };
    }
    if (canOpenLimp({ position, tier: features.tier, personality })) {
      return { actionType: "call", amount: null as number | null };
    }
    return { actionType: "fold", amount: null as number | null };
  }

  if (bucket === "limped") {
    if (toCall <= 0) return { actionType: "check", amount: null as number | null };
    const isoThreshold = 3.15 - style.openShift * 0.45 - readShift * 0.55 + Math.max(0, preflopLimperCount - 1) * 0.12;
    if (handScore >= isoThreshold || features.tier === "premium" || (features.tier === "strong" && preflopLimperCount <= 2)) {
      const targetAmount = raiseTargetAmount(
        humanOpenRaiseTargetBb({
          position,
          personality,
          limperCount: Math.max(1, preflopLimperCount),
          handTier: features.tier,
        })
      );
      if (targetAmount != null) return { actionType: "raise", amount: targetAmount };
    }
    if (canFlatOpen({
      features,
      tier: features.tier,
      position,
      toCallBb: Math.max(1, toCallBb),
      effectiveStackBb,
      activeSeatCount,
      personality,
    })) {
      return { actionType: "call", amount: null as number | null };
    }
    return { actionType: toCall > 0 ? "fold" : "check", amount: null as number | null };
  }

  if (bucket === "vs_open") {
    if (features.tier === "premium") {
      if (jamNow) return { actionType: "all_in", amount: null as number | null };
      const targetAmount = raiseTargetAmount(
        humanThreeBetTargetBb({ currentBetBb, inPosition, personality })
      );
      if (targetAmount != null) return { actionType: "raise", amount: targetAmount };
      return { actionType: "call", amount: null as number | null };
    }

    if (features.tier === "strong") {
      const shouldThreeBet =
        features.paired
        || (features.aceHigh && features.lowRank >= 11)
        || (features.suited && features.highRank >= 13 && features.lowRank >= 11);
      const threeBetChance = clamp(0.22 + style.threeBetShift * 0.4 + readShift * 0.28, 0.08, 0.58);
      if (shouldThreeBet && coinFlip(threeBetChance)) {
        const targetAmount = raiseTargetAmount(
          humanThreeBetTargetBb({ currentBetBb, inPosition, personality })
        );
        if (targetAmount != null) return { actionType: "raise", amount: targetAmount };
      }
      if (canFlatOpen({
        features,
        tier: features.tier,
        position,
        toCallBb,
        effectiveStackBb,
        activeSeatCount,
        personality,
      })) {
        return { actionType: "call", amount: null as number | null };
      }
      return { actionType: "fold", amount: null as number | null };
    }

    if (features.tier === "value") {
      const squeezeChance = clamp((personality === "LAG" ? 0.16 : personality === "TAG" ? 0.1 : 0.04) + readShift * 0.2, 0, 0.26);
      if (coinFlip(squeezeChance) && currentBetBb <= 4.2 && activeSeatCount <= 4) {
        const targetAmount = raiseTargetAmount(
          humanThreeBetTargetBb({ currentBetBb, inPosition, personality })
        );
        if (targetAmount != null) return { actionType: "raise", amount: targetAmount };
      }
      if (canFlatOpen({
        features,
        tier: features.tier,
        position,
        toCallBb,
        effectiveStackBb,
        activeSeatCount,
        personality,
      })) {
        return { actionType: "call", amount: null as number | null };
      }
      return { actionType: "fold", amount: null as number | null };
    }

    if (canFlatOpen({
      features,
      tier: features.tier,
      position,
      toCallBb,
      effectiveStackBb,
      activeSeatCount,
      personality,
    })) {
      return { actionType: "call", amount: null as number | null };
    }
    return { actionType: "fold", amount: null as number | null };
  }

  if (bucket === "vs_3bet") {
    if (features.tier === "premium") {
      if (jamNow) return { actionType: "all_in", amount: null as number | null };
      const targetAmount = raiseTargetAmount(
        humanFourBetTargetBb({ currentBetBb, inPosition, personality, effectiveStackBb })
      );
      if (targetAmount != null) return { actionType: "raise", amount: targetAmount };
      return { actionType: "call", amount: null as number | null };
    }

    if (features.tier === "strong" && canContinueVsThreeBet({
      features,
      tier: features.tier,
      position,
      toCallBb,
      effectiveStackBb,
      personality,
    })) {
      return { actionType: "call", amount: null as number | null };
    }

    if ((features.tier === "value" || features.tier === "speculative") && canContinueVsThreeBet({
      features,
      tier: features.tier,
      position,
      toCallBb,
      effectiveStackBb,
      personality,
    })) {
      return { actionType: "call", amount: null as number | null };
    }

    return { actionType: "fold", amount: null as number | null };
  }

  if (features.tier === "premium") {
    if (jamNow) return { actionType: "all_in", amount: null as number | null };
    if (toCallBb <= Math.max(8, effectiveStackBb * 0.24)) {
      return { actionType: "call", amount: null as number | null };
    }
  }
  return { actionType: "fold", amount: null as number | null };
}

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
  streetAggressionCount = 0,
  preflopLimperCount = 0,
  effectiveStackBb = null,
  startingStackBb = null,
  averageOpponentStackBb = null,
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
  streetAggressionCount?: number;
  preflopLimperCount?: number;
  effectiveStackBb?: number | null;
  startingStackBb?: number | null;
  averageOpponentStackBb?: number | null;
}) {
  const toCall = Math.max(0, (currentBet || 0) - (streetContribution || 0));
  const stack = stackEnd || 0;
  const blind = Math.max(1, Number(bigBlind || 2));
  const stackBb = stackInBigBlinds(stack, blind);
  const isPreflop = street === "preflop" || !boardCards || boardCards.length < 3;
  const isFlop = street === "flop";
  const postflop = isPreflop ? { strength: 0, drawStrength: 0, classRank: null } : analyzePostflopHand(holeCards, boardCards);

  if (stack <= 0) return { actionType: "check", amount: null as number | null };

  const rawStrength = isPreflop
    ? preflopStrength(holeCards?.[0], holeCards?.[1])
    : postflop.strength;
  const drawStrength = isPreflop ? 0 : postflop.drawStrength;
  const madeClassRank = isPreflop ? null : postflop.classRank;
  const effectiveStackForStreetBb = Math.max(1, Math.min(
    stackBb + Number(streetContribution || 0) / blind,
    Number(effectiveStackBb || (stackBb + Number(streetContribution || 0) / blind))
  ));
  const livePersonality = resolveDynamicBotPersonality({
    basePersonality: personality,
    stackBb: stackBb + Number(streetContribution || 0) / blind,
    effectiveStackBb: effectiveStackForStreetBb,
    startingStackBb,
    averageOpponentStackBb,
    opponentProfile,
    activeSeatCount,
  });
  const profile = PROFILES[livePersonality] || PROFILES.TAG;

  const posMult = positionMultiplier(seatNo || 0, buttonSeat || 0, totalSeats || 6, activeSeatCount || 2);
  const opAdj = opponentAdjustments(opponentProfile || null, livePersonality);
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
  const spr = stackToPotRatio(stack, pot || 0, toCall);
  const riskFraction = isPreflop
    ? 1
    : postflopRiskFraction({
      street,
      madeClassRank,
      effectiveStrength,
      drawStrength,
      spr,
      personality: livePersonality,
    });
  const canStackOffPostflop = !isPreflop && shouldStackOffPostflop({
    madeClassRank,
    effectiveStrength,
    drawStrength,
    spr,
  });

  if (isPreflop) {
    return decideStructuredPreflopAction({
      personality: livePersonality,
      holeCards,
      currentBet,
      streetContribution,
      stack,
      bigBlind: blind,
      seatNo,
      buttonSeat,
      totalSeats,
      activeSeatCount,
      rawStrength,
      effectiveStrength,
      opponentProfile,
      streetAggressionCount,
      preflopLimperCount,
      effectiveStackBbHint: effectiveStackForStreetBb,
    });
  }

  if (isFlop && wasAggressor && currentBet === 0 && toCall === 0) {
    const cbetRate = Math.min(
      0.92,
      profile.cbetRate + (strongDraw ? 0.08 : 0) + (premiumMadeHand ? 0.06 : 0) + opAdj.bluffMod * 0.35 + opAdj.betMod * 0.2
    );
    if (coinFlip(cbetRate)) {
      const cbetSize = Math.max(
        Math.round(pot * postflopSizeFraction({
          madeClassRank,
          effectiveStrength,
          drawStrength,
          personality: livePersonality,
          bluff: !premiumMadeHand,
        })),
        blind
      );
      const cappedCbet = capTargetByRisk({
        desiredTarget: cbetSize,
        streetContribution,
        stack,
        riskFraction,
      });
      if (cappedCbet > 0 && cappedCbet < stack) {
        return { actionType: "bet", amount: cappedCbet };
      }
      if (canStackOffPostflop) {
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
        const raiseSize = Math.max(
          Math.round(pot * postflopSizeFraction({
          madeClassRank,
          effectiveStrength,
          drawStrength,
          personality: livePersonality,
          bluff: true,
        })),
          blind
        );
        const raiseTarget = (currentBet || 0) + raiseSize;
        const cappedTarget = capTargetByRisk({
          desiredTarget: raiseTarget,
          streetContribution,
          stack,
          riskFraction,
        });
        if (cappedTarget > (currentBet || 0) + blind * 0.9) {
          return { actionType: "raise", amount: cappedTarget };
        }
        if (canStackOffPostflop) {
          return { actionType: "all_in", amount: null as number | null };
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
    if (currentBet > 0) {
      const raiseSize = Math.max(
        Math.round(pot * postflopSizeFraction({
          madeClassRank,
          effectiveStrength,
          drawStrength,
          personality: livePersonality,
        })),
        blind
      );
      const raiseTarget = (currentBet || 0) + raiseSize;
      const cappedTarget = capTargetByRisk({
        desiredTarget: raiseTarget,
        streetContribution,
        stack,
        riskFraction,
      });
      if (cappedTarget > (currentBet || 0) + blind * 0.9) {
        return { actionType: "raise", amount: cappedTarget };
      }
      if (canStackOffPostflop) {
        return { actionType: "all_in", amount: null as number | null };
      }
      return toCall > 0 ? { actionType: "call", amount: null as number | null } : { actionType: "check", amount: null as number | null };
    }

    const betSize = Math.max(
      Math.round(pot * postflopSizeFraction({
        madeClassRank,
        effectiveStrength,
        drawStrength,
        personality: livePersonality,
      })),
      blind
    );
    const cappedBet = capTargetByRisk({
      desiredTarget: betSize,
      streetContribution,
      stack,
      riskFraction,
    });
    if (cappedBet > 0 && cappedBet < stack) {
      return { actionType: "bet", amount: cappedBet };
    }
    if (canStackOffPostflop) {
      return { actionType: "all_in", amount: null as number | null };
    }
    return { actionType: "check", amount: null as number | null };
  }

  if (toCall > 0) {
    if (toCall > stack) {
      return canStackOffPostflop && coinFlip(adjustedCallRate)
        ? { actionType: "all_in", amount: null as number | null }
        : { actionType: "fold", amount: null as number | null };
    }

    const potOdds = toCall / Math.max(1, pot + toCall);
    if (effectiveStrength < potOdds * 1.1) {
      return coinFlip(0.2) ? { actionType: "call", amount: null as number | null } : { actionType: "fold", amount: null as number | null };
    }

    return coinFlip(adjustedCallRate) ? { actionType: "call", amount: null as number | null } : { actionType: "fold", amount: null as number | null };
  }

  if (strongDraw && coinFlip(0.42)) {
    const semibluffSize = Math.max(
      Math.round(pot * postflopSizeFraction({
        madeClassRank,
        effectiveStrength,
        drawStrength,
        personality: livePersonality,
        bluff: true,
      })),
      blind
    );
    const cappedSemibluff = capTargetByRisk({
      desiredTarget: semibluffSize,
      streetContribution,
      stack,
      riskFraction,
    });
    if (cappedSemibluff > 0 && cappedSemibluff < stack) {
      return { actionType: "bet", amount: cappedSemibluff };
    }
  }

  if (effectiveStrength > adjustedFoldThreshold + 0.15 && coinFlip(0.3)) {
    const betSize = Math.max(
      Math.round(pot * postflopSizeFraction({
        madeClassRank,
        effectiveStrength,
        drawStrength,
        personality: livePersonality,
        bluff: false,
      })),
      blind
    );
    const cappedBet = capTargetByRisk({
      desiredTarget: betSize,
      streetContribution,
      stack,
      riskFraction,
    });
    if (cappedBet > 0 && cappedBet < stack) {
      return { actionType: "bet", amount: cappedBet };
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
