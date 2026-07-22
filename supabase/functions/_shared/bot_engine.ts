import { describeSevenCardHand } from "./showdown.ts";
import { monteCarloEquity } from "./equity.ts";

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

  // Chen-style weighting: the high card dominates, the low card is a modest
  // kicker, pairs get a floor above unpaired hands of the same high card. The
  // old additive (hi+lo)/28 formula ranked KQo above KK and T9o above 66, which
  // leaked straight into the shove gates.
  let score = 0;
  if (paired) {
    score = 0.55 + (hi / 14) * 0.45;
  } else {
    const gap = hi - lo;
    score = (hi / 14) * 0.6 + (lo / 14) * 0.2;
    if (suited) score += 0.06;
    if (gap <= 1) score += 0.03;
    else if (gap <= 2) score += 0.015;
    else if (gap >= 4) score -= 0.03;
    if (hi >= 14) score += 0.06;
    else if (hi >= 13) score += 0.03;
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
  // Round DOWN to the half-BB grid: rounding up could push a raise-to past the
  // bot's actual stack (raise_exceeds_stack) when the target was stack-capped.
  return Math.max(
    Math.max(1, Number(bigBlind || 2)),
    Math.floor(Math.max(0, targetBb) * 2) / 2 * Math.max(1, Number(bigBlind || 2))
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
  // dist counts clockwise FROM the button, so a LARGE dist means the seat is
  // close behind the button (cutoff/hijack = late) and a SMALL dist (just after
  // the blinds) is early. The old mapping was inverted.
  const normalized = dist / Math.max(1, totalSeats);
  if (normalized >= 0.72) return "cutoff";
  if (normalized >= 0.52) return "middle";
  return "early";
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

// A bounded, per-hand "risk mood" in ~[-0.16, +0.16]. The deterministic half is
// seeded from the hole cards + seat so a bot plays a whole street with a
// consistent temperament (loose this hand, cautious the next); the random half
// keeps it genuinely unpredictable so a human can't read a fixed range. Positive
// = greedier (peel/chase/hero-call more), negative = tighter. It shifts the
// mixing around the EV center; it never overrides clear +EV/-EV math.
function handRiskMood(holeCards: string[] | undefined, seatNo: number, street: string, personality: BotPersonality) {
  const seed = `${holeCards?.[0] || ""}${holeCards?.[1] || ""}|${seatNo}|${street}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const deterministic = ((h >>> 0) % 1000) / 1000 - 0.5; // stable per hand
  const jitter = rand(-0.5, 0.5);                         // live variance
  const style = PREFLOP_STYLE[personality] || PREFLOP_STYLE.TAG;
  return clamp((deterministic * 0.6 + jitter * 0.4) * 0.22 + style.riskShift * 0.5, -0.16, 0.16);
}

// How willing the bot is to peel/gamble beyond its disciplined range when facing
// a raise. Kept small (<=~0.3) so the EV center holds, but never zero so "big
// raise = auto-fold" is never a safe read. Weighted toward implied-odds hands
// (pairs to set-mine, suited connectors), position, personality, the opponent
// read, and the current risk mood; shrinks as the price grows.
function curiosityContinueProb({
  features,
  tier,
  toCallBb,
  effectiveStackBb,
  position,
  personality,
  readShift,
  mood,
  defendShift = 0,
}: {
  features: PreflopFeatures;
  tier: PreflopTier;
  toCallBb: number;
  effectiveStackBb: number;
  position: PositionBand;
  personality: BotPersonality;
  readShift: number;
  mood: number;
  defendShift?: number;
}) {
  if (toCallBb <= 0) return 0;
  if (toCallBb > effectiveStackBb * 0.5 || toCallBb > 24) return 0.02;
  const inPos = isInPosition(position);
  const inBigBlind = position === "big_blind" || position === "heads_up_big_blind";
  let p = 0.05;
  p += tier === "trash" ? -0.02 : tier === "marginal" ? 0.01 : 0.04;
  if (features.paired) p += 0.06;
  if (features.suited && features.connected) p += 0.05;
  else if (features.suited) p += 0.02;
  if (inPos) p += 0.03;
  if (personality === "Station") p += 0.06;
  else if (personality === "LAG") p += 0.03;
  else if (personality === "Rock") p -= 0.03;
  p += (readShift || 0) * 0.3;
  p += (mood || 0);
  // Character gamble factor: table-talkers and maniacs look raises up more so a
  // pot-size open doesn't clear the whole table every time. Fades as the price
  // climbs so it never turns into stack-off spew.
  const gamble = Math.max(0, Number(defendShift || 0));
  if (gamble > 0) p += gamble * (toCallBb <= 6 ? 1 : 0.35);
  // BB closes the action at a discount — defend it like a human would.
  if (inBigBlind && toCallBb <= 4.5) p += 0.08;
  p *= clamp(1 - (toCallBb - 3) / 22, 0.3, 1);
  return clamp(p, 0.02, 0.3 + gamble + (inBigBlind ? 0.06 : 0));
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
  // Size bands overlap deliberately: a strict size=f(strength) mapping is a
  // perfect tell (any large bet = value, any small bet = weak). ~25% of bluffs
  // use a big "value-looking" size and ~20% of value bets use a small
  // "bluff-looking" size, so sizing alone can't be read.
  if (bluff) {
    if (coinFlip(0.25)) return clamp(rand(0.6, 0.85), 0.55, 0.9);
    if (drawStrength >= 0.12) return clamp(rand(0.42, 0.62) + (personality === "LAG" ? 0.04 : 0), 0.38, 0.68);
    return clamp(rand(0.33, 0.5) + (personality === "LAG" ? 0.03 : 0), 0.3, 0.58);
  }
  if ((madeClassRank || 0) >= 2 && coinFlip(0.2)) return clamp(rand(0.38, 0.55), 0.34, 0.6);
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

function shouldCallCheapPostflopPrice({
  street,
  toCall,
  pot,
  blind,
  madeClassRank,
  effectiveStrength,
  drawStrength,
}: {
  street: string;
  toCall: number;
  pot: number;
  blind: number;
  madeClassRank: number | null;
  effectiveStrength: number;
  drawStrength: number;
}) {
  if (toCall <= 0) return false;
  const potOdds = toCall / Math.max(1, pot + toCall);
  const tinyBlindCall = toCall <= Math.max(blind * 4, 1);
  const cheapPotPrice = potOdds <= 0.09;
  if (!tinyBlindCall && !cheapPotPrice) return false;

  if ((madeClassRank || 0) >= 1) return true;
  if (drawStrength >= 0.08 && street !== "river") return true;
  if (street === "river") return effectiveStrength >= 0.44;
  return effectiveStrength >= 0.58;
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

function bestStraightDrawScore(
  cards: Array<{ rank: number; suit: string }>,
  holeRanks: number[] = []
) {
  const ranks = uniqueRanksWithWheel(cards);
  if (ranks.length < 4) return 0;
  // A "draw" that exists entirely on the board is everyone's draw — require at
  // least one hole card inside the straight window before crediting it.
  const holeSet = new Set(holeRanks);
  if (holeSet.has(14)) holeSet.add(1);
  let best = 0;
  for (let start = 1; start <= 10; start += 1) {
    const window = [start, start + 1, start + 2, start + 3, start + 4];
    const hits = window.filter((rank) => ranks.includes(rank)).length;
    if (hits >= 4) {
      const usesHole = holeSet.size === 0 || window.some((rank) => holeSet.has(rank));
      if (!usesHole) continue;
      const edgeHits = [window[0], window[4]].filter((rank) => ranks.includes(rank)).length;
      best = Math.max(best, hits === 5 ? 0.18 : edgeHits === 2 ? 0.13 : 0.08);
    }
  }
  return best;
}

function drawPotential(holeCards: string[], boardCards: string[], classRank = 0, street = "flop") {
  // Draws have zero value on the river — there are no more cards to come. The
  // old code kept valuing busted 4-flushes/4-straights and called river bets
  // with them.
  if (street === "river") return 0;
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

  const straightDraw = bestStraightDrawScore(cards, parsedHole.map((card) => card.rank));
  return Math.min(0.24, flushDraw + straightDraw);
}

// Class of the best hand the BOARD makes by itself. For a full 5-card board any
// class is possible; on 3-4 card boards only rank-multiset classes can exist.
// Used to detect "playing the board": if the bot's 7-card hand isn't better than
// what every player already shares, its "made hand" is at best a chop.
function boardOnlyClassRank(parsedBoard: Array<{ rank: number; suit: string }>) {
  if (!parsedBoard || parsedBoard.length < 3) return 0;
  const rankCounts = parsedBoard.reduce<Record<number, number>>((acc, card) => {
    acc[card.rank] = (acc[card.rank] || 0) + 1;
    return acc;
  }, {});
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  let cls = 0;
  if (counts[0] === 4) cls = 7;
  else if (counts[0] === 3 && (counts[1] || 0) >= 2) cls = 6;
  else if (counts[0] === 3) cls = 3;
  else if (counts[0] === 2 && (counts[1] || 0) >= 2) cls = 2;
  else if (counts[0] === 2) cls = 1;
  if (parsedBoard.length === 5) {
    const suitCounts = parsedBoard.reduce<Record<string, number>>((acc, card) => {
      acc[card.suit] = (acc[card.suit] || 0) + 1;
      return acc;
    }, {});
    const isFlush = Object.values(suitCounts).some((count) => count >= 5);
    const ranks = uniqueRanksWithWheel(parsedBoard);
    let isStraight = false;
    for (let i = 0; i + 4 < ranks.length; i += 1) {
      if (ranks[i + 4] - ranks[i] === 4) { isStraight = true; break; }
    }
    if (isFlush && isStraight) cls = Math.max(cls, 8);
    else if (isFlush) cls = Math.max(cls, 5);
    else if (isStraight) cls = Math.max(cls, 4);
  }
  return cls;
}

// Which ranks the made hand is built from, per class — used to check whether a
// hole card actually participates in the made hand.
function madeHandRanks(result: ReturnType<typeof describeSevenCardHand>) {
  const cls = result?.classRank || 0;
  const tuple = result?.tuple || [];
  if (cls === 1 || cls === 3 || cls === 7) return [Number(tuple[1] || 0)];
  if (cls === 2 || cls === 6) return [Number(tuple[1] || 0), Number(tuple[2] || 0)];
  return [];
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

function analyzePostflopHand(holeCards: string[], boardCards: string[], street = "flop") {
  if (!holeCards || holeCards.length < 2 || !boardCards || boardCards.length < 3) {
    return { strength: 0.3, drawStrength: 0, classRank: null as number | null, holeParticipates: false };
  }
  try {
    const allCards = [...holeCards, ...boardCards];
    const result = describeSevenCardHand(allCards);
    if (result.classRank == null) {
      return { strength: 0.3, drawStrength: 0, classRank: null, holeParticipates: false };
    }

    const parsedHole = holeCards.map(toParsedCard).filter(Boolean) as Array<{ rank: number; suit: string }>;
    const parsedBoard = boardCards.map(toParsedCard).filter(Boolean) as Array<{ rank: number; suit: string }>;
    const holeRanks = parsedHole.map((card) => card.rank);
    const boardClass = boardOnlyClassRank(parsedBoard);

    // Does a hole card actually participate in the made hand?
    let holeParticipates = true;
    let kickerRank = Number(result.tuple[1] || 7);
    if (result.classRank === 5) {
      // Flush: credit the bot's own flush card, not the board's top flush card
      // (2h3h on an all-heart board is NOT the nut flush).
      const counts: Record<string, number> = {};
      for (const card of [...parsedHole, ...parsedBoard]) counts[card.suit] = (counts[card.suit] || 0) + 1;
      const flushSuit = Object.keys(counts).find((suit) => counts[suit] >= 5);
      const holeFlush = parsedHole.filter((card) => card.suit === flushSuit).map((card) => card.rank);
      holeParticipates = holeFlush.length > 0;
      kickerRank = holeFlush.length ? Math.max(...holeFlush) : 0;
    } else if ([1, 2, 3, 6, 7].includes(result.classRank)) {
      const made = madeHandRanks(result);
      holeParticipates = made.some((rank) => holeRanks.includes(rank));
    }
    // For straights/other classes: if the board alone already makes an equal or
    // better class, the hand adds nothing.
    if (boardClass >= result.classRank && !([1, 2, 3, 6, 7].includes(result.classRank) && holeParticipates)) {
      // Playing the board (or the board itself beats the hand's class): at best
      // a chop. Keep a little value for the chop, credit nothing else.
      const chopStrength = 0.28 + boardClass * 0.005;
      const drawStrengthPB = drawPotential(holeCards, boardCards, result.classRank, street);
      return { strength: chopStrength, drawStrength: drawStrengthPB, classRank: result.classRank, holeParticipates: false };
    }

    const base = result.classRank / 8;
    const kicker = (holeParticipates ? kickerRank || 7 : 0) / 14;
    const drawStrength = drawPotential(holeCards, boardCards, result.classRank, street);
    const pairEdge = pairBonus(holeCards, boardCards, result);
    const strength = Math.min(1.0, Math.max(0.0, base * 0.72 + kicker * 0.18 + drawStrength + pairEdge));
    return { strength, drawStrength, classRank: result.classRank, holeParticipates };
  } catch {
    return { strength: 0.3, drawStrength: 0, classRank: null as number | null, holeParticipates: false };
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
    // Tight player: bluff them more, and RESPECT their bets (raise the fold
    // threshold). The old sign lowered it — calling looser against nits.
    bluffMod += 0.06 * confidenceScale;
    foldMod += 0.05 * confidenceScale;
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
    foldMod += 0.04 * confidenceScale * style.pressureGain;
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

  // Button acts last (best position), blinds act first postflop (worst), and
  // lateness otherwise grows with dist from the button. The old scale boosted
  // the blinds and penalized the cutoff.
  if (dist === 0) return 1.15;
  if (dist === 1 || dist === 2) return 0.9;
  if (normalizedPos >= 0.72) return 1.08;
  if (normalizedPos >= 0.52) return 1.0;
  return 0.93;
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
    // Recalibrated to the real effectiveStrength scale (a set peaks ~0.55, a
    // flush ~0.65): 0.75 meant Rock could never value-raise below a boat.
    raiseAbove: 0.5,
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
    // Same recalibration as Rock: 0.8 was unreachable below a full house.
    raiseAbove: 0.55,
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
  preflopStyleOverride = null,
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
  preflopStyleOverride?: Record<string, number> | null;
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
  const style = { ...(PREFLOP_STYLE[personality] || PREFLOP_STYLE.TAG), ...(preflopStyleOverride || {}) };
  const readShift = preflopReadShift(opponentProfile || null, personality);
  const handScore = features.tierScore + rawStrength * 0.9;

  // Facing a raise, don't fold a fixed range every time — peel occasionally so
  // the decision stays unpredictable and priced by mood/read, not a hard cap.
  const riskMood = handRiskMood(holeCards, seatNo, "preflop", personality);
  const curiosityFold = () => (
    coinFlip(curiosityContinueProb({
      features,
      tier: features.tier,
      toCallBb,
      effectiveStackBb,
      position,
      personality,
      readShift,
      mood: riskMood,
      defendShift: Number((style as Record<string, number>).defendShift || 0),
    }))
      ? { actionType: "call", amount: null as number | null }
      : { actionType: "fold", amount: null as number | null }
  );

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
  // Short stacks open-shove instead of min-opening themselves pot-committed.
  // The jam rule used to be consulted only inside premium branches, so the
  // <=8.5bb "jam anything decent" clause could never fire.
  const shortStackJam = jamNow && effectiveStackBb <= 12 && features.tier !== "trash";

  if (bucket === "unopened") {
    if (toCall <= 0) return { actionType: "check", amount: null as number | null };
    if (shortStackJam) return { actionType: "all_in", amount: null as number | null };
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
    if (shortStackJam) return { actionType: "all_in", amount: null as number | null };
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
      return curiosityFold();
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
      return curiosityFold();
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
    return curiosityFold();
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

    return curiosityFold();
  }

  if (features.tier === "premium") {
    if (jamNow) return { actionType: "all_in", amount: null as number | null };
    if (toCallBb <= Math.max(8, effectiveStackBb * 0.24)) {
      return { actionType: "call", amount: null as number | null };
    }
  }
  return curiosityFold();
}

function decideBotActionCore({
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
  selfImageProfile = null,
  banditNudge = 0,
  styleOverrides = null,
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
  selfImageProfile?: OpponentProfile | null;
  banditNudge?: number;
  styleOverrides?: { profile?: Record<string, number>; preflop?: Record<string, number> } | null;
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
  const postflop = isPreflop
    ? { strength: 0, drawStrength: 0, classRank: null as number | null, holeParticipates: false }
    : analyzePostflopHand(holeCards, boardCards, street);

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
  const profile = { ...(PROFILES[livePersonality] || PROFILES.TAG), ...(styleOverrides && styleOverrides.profile ? styleOverrides.profile : {}) };
  // Per-hand risk mood (postflop): nudges call/fold mixing so the bot doesn't
  // fold or call a fixed range every time — keeps it unreadable and un-trappable.
  const riskMood = isPreflop ? 0 : handRiskMood(holeCards, seatNo, street, livePersonality);

  const posMult = positionMultiplier(seatNo || 0, buttonSeat || 0, totalSeats || 6, activeSeatCount || 2);
  const opAdj = opponentAdjustments(opponentProfile || null, livePersonality);
  // Table image: adapt to how the FIELD currently reads this bot. If we look
  // bluffy (they'll call us down) bluff less and value-bet a touch thinner; if we
  // look nitty (they fold to us) bluff/steal more. Scaled by how much they've
  // actually seen (confidence), so a fresh table barely moves us.
  let imageBluffAdj = 0;
  let imageValueAdj = 0;
  if (selfImageProfile) {
    const imgConf = clamp(Number(selfImageProfile.confidence || 0), 0, 1);
    const selfTags = selfImageProfile.tags || [];
    let raw = 0;
    if (selfTags.includes("bluff-heavy") || selfTags.includes("lag")) raw -= 0.09;
    else if (selfTags.includes("station")) raw -= 0.05;
    if (selfTags.includes("nit")) raw += 0.08;
    else if (selfTags.includes("tag")) raw += 0.03;
    if (Number(selfImageProfile.aggression || 0) > 1.7) raw -= 0.04;
    imageBluffAdj = raw * imgConf;
    imageValueAdj = (-raw) * imgConf * 0.5; // looking bluffy -> get paid on value
  }
  const noise = rand(-0.05, 0.05);
  const effectiveStrength = Math.min(1.0, Math.max(0.0, rawStrength * posMult + noise));
  // banditNudge is the learned adjustment from this bot's actual bluff-through
  // rate at this street (foldy table -> bluff more; sticky -> bluff less).
  const adjustedBluffRate = clamp(profile.bluffRate + opAdj.bluffMod + imageBluffAdj + Number(banditNudge || 0), 0, 0.3);
  const adjustedFoldThreshold = isPreflop
    ? Math.max(0.1, profile.preflopFoldBelow + opAdj.foldMod)
    : Math.max(0.1, profile.postflopFoldBelow + opAdj.foldMod);
  const adjustedRaiseAbove = Math.max(0.3, profile.raiseAbove - opAdj.betMod - imageValueAdj);
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
      preflopStyleOverride: styleOverrides && styleOverrides.preflop ? styleOverrides.preflop : null,
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

  // Price awareness FIRST: never fold to a tiny bet with a piece of the board.
  // This used to run after the static fold-threshold check, which made bottom
  // pair fold to a 1-chip bet into a huge pot.
  if (!isPreflop && toCall > 0 && shouldCallCheapPostflopPrice({
    street,
    toCall,
    pot,
    blind,
    madeClassRank,
    effectiveStrength,
    drawStrength,
  })) {
    return { actionType: "call", amount: null as number | null };
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
    // Real win probability via Monte Carlo -- samples the remaining board and
    // opponent hands and counts how often we win. Replaces the old class-based
    // strength floors (a hack for the heuristic topping out ~0.5-0.6, which
    // folded sets and two pair to overbets). Draws are already captured (we deal
    // future board cards).
    //
    // Betting-line hand reading: rather than assume opponents hold random junk,
    // infer how strong their range is from THIS hand's line -- a bigger bet, a
    // later street, and a read that they don't bluff all mean a tighter, more
    // connected range -- and bias the sampled opponent hands toward it. A nit
    // betting big into the river is modelled near the nuts; a station or a
    // bluff-heavy villain much looser.
    let villainTightness = clamp(potOdds * 1.1, 0, 0.6);
    if (street === "river") villainTightness += 0.12;
    else if (street === "turn") villainTightness += 0.05;
    const opRead = opponentProfile || null;
    if (opRead) {
      const opTags = opRead.tags || [];
      if (opTags.includes("nit")) villainTightness += 0.15;
      if (opTags.includes("station")) villainTightness -= 0.15;
      if (opTags.includes("bluff-heavy")) villainTightness -= 0.18;
      if (Number(opRead.foldToBet || 0) > 0.6) villainTightness += 0.08;
      if (Number(opRead.aggression || 0) > 1.6) villainTightness -= 0.1;
    }
    villainTightness = clamp(villainTightness, 0, 0.85);

    let callEquity = effectiveStrength;
    const mcEquity = monteCarloEquity({
      holeCards,
      boardCards,
      opponents: clamp(activeSeatCount - 1, 1, 4),
      villainTightness,
    });
    if (Number.isFinite(mcEquity)) {
      callEquity = clamp(mcEquity, 0, 1);
    }
    if (callEquity < potOdds) {
      // Curiosity / float call when priced badly — small, but mood- and
      // draw-weighted so "I bet, they always fold" is never a safe read.
      const curioProb = clamp(0.05 + Math.max(0, riskMood) + (postflop.holeParticipates ? 0.03 : 0), 0.02, 0.28);
      return (potOdds <= 0.42 && coinFlip(curioProb))
        ? { actionType: "call", amount: null as number | null }
        : { actionType: "fold", amount: null as number | null };
    }

    // The personality call-rate should only mix in MARGINAL spots. With a big
    // equity margin over the price, folding is a pure punt (the old flat coin
    // flip folded strong hands 30% of the time even getting great odds).
    const equityMargin = callEquity - potOdds;
    const continueProb = equityMargin >= 0.25
      ? clamp(0.97 + riskMood * 0.15, 0.9, 0.99)
      : clamp(adjustedCallRate + equityMargin + riskMood, 0.38, 0.97);
    return coinFlip(continueProb) ? { actionType: "call", amount: null as number | null } : { actionType: "fold", amount: null as number | null };
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

// Awareness/legality layer. The core above decides the INTENT; this wrapper
// makes sure the action that leaves the engine is one the table rules allow —
// the way a human simply knows the rules:
//   - never bet/raise when no opponent can respond (lone all-in behind);
//   - never raise when betting isn't reopened for us (short all-in rule);
//   - raise at least the legal minimum or don't raise at all (call instead);
//   - never raise past the stack (that's just all-in);
//   - keep amounts on the half-big-blind grid;
//   - never "check" facing a bet or "call" nothing.
// Every prior server rejection (raise_below_min, raise_exceeds_stack,
// no_opponents_left_to_raise, bet_below_big_blind, nothing_to_call) maps to one
// of these clamps.
export function decideBotAction(
  input: Parameters<typeof decideBotActionCore>[0] & {
    minRaise?: number | null;
    raiseEligibleOpponents?: number | null;
    raiseLocked?: boolean;
  }
) {
  const { minRaise = null, raiseEligibleOpponents = null, raiseLocked = false } = input;
  const blind = Math.max(1, Number(input.bigBlind || 2));
  const currentBet = Number(input.currentBet || 0);
  const contribution = Number(input.streetContribution || 0);
  const stack = Number(input.stackEnd || 0);
  const toCall = Math.max(0, currentBet - contribution);
  const maxTotal = contribution + stack;
  const canAnyoneRespond = raiseEligibleOpponents == null || Number(raiseEligibleOpponents) > 0;
  const minLegalRaiseTo = currentBet + Math.max(Number(minRaise || 0), blind);
  const halfBb = blind / 2;
  const grid = (value: number) => Math.round(Number(value || 0) / halfBb) * halfBb;
  const money = (value: number) => Math.round(value * 100) / 100;

  let action = decideBotActionCore(input);

  const isAggression = action.actionType === "bet" || action.actionType === "raise"
    || (action.actionType === "all_in" && maxTotal > currentBet + 1e-9);
  if (isAggression && (!canAnyoneRespond || raiseLocked)) {
    action = { actionType: toCall > 0 ? "call" : "check", amount: null };
  }

  if (action.actionType === "bet" && action.amount != null) {
    let amount = Math.max(grid(Number(action.amount)), Math.min(blind, stack));
    if (amount >= stack - 1e-9) return { actionType: "all_in", amount: null };
    return { actionType: "bet", amount: money(amount) };
  }

  if (action.actionType === "raise" && action.amount != null) {
    let target = grid(Number(action.amount));
    if (target < minLegalRaiseTo) {
      const addNeeded = minLegalRaiseTo - contribution;
      if (minLegalRaiseTo <= maxTotal - 1e-9 && addNeeded <= stack * 0.62) {
        // Raise properly: bump to the legal minimum (ceil onto the grid).
        target = Math.ceil(minLegalRaiseTo / halfBb) * halfBb;
      } else {
        // The legal minimum is too big a share of the stack for the intent —
        // a human just calls here instead of turning a raise into a shove.
        return { actionType: toCall > 0 ? "call" : "check", amount: null };
      }
    }
    if (target >= maxTotal - 1e-9) return { actionType: "all_in", amount: null };
    return { actionType: "raise", amount: money(target) };
  }

  if (action.actionType === "call" && toCall <= 0) {
    return { actionType: "check", amount: null };
  }
  if (action.actionType === "check" && toCall > 0) {
    return toCall <= blind * 2
      ? { actionType: "call", amount: null }
      : { actionType: "fold", amount: null };
  }
  return action;
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
