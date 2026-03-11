import { decideBotAction, resolveDynamicBotPersonality } from "./bot_engine.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function withFixedRandom<T>(fn: () => T) {
  const original = Math.random;
  Math.random = () => 0.5;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function run() {
  const deepLeadRock = resolveDynamicBotPersonality({
    basePersonality: "Rock",
    stackBb: 160,
    effectiveStackBb: 70,
    startingStackBb: 100,
    averageOpponentStackBb: 62,
    activeSeatCount: 6,
  });
  assert(deepLeadRock === "TAG", "Big-stack Rocks should loosen into a value-seeking TAG style");

  const shortLag = resolveDynamicBotPersonality({
    basePersonality: "LAG",
    stackBb: 28,
    effectiveStackBb: 12,
    startingStackBb: 100,
    averageOpponentStackBb: 55,
    activeSeatCount: 6,
  });
  assert(shortLag === "TAG", "Short-stacked LAGs should tighten up instead of punting");

  const premiumOpen = withFixedRandom(() => decideBotAction({
    personality: "TAG",
    holeCards: ["As", "Ah"],
    boardCards: [],
    pot: 3,
    currentBet: 2,
    streetContribution: 0,
    stackEnd: 200,
    bigBlind: 2,
    street: "preflop",
    seatNo: 4,
    buttonSeat: 1,
    totalSeats: 6,
    activeSeatCount: 6,
    wasAggressor: false,
    streetAggressionCount: 0,
    preflopLimperCount: 0,
    effectiveStackBb: 100,
    startingStackBb: 100,
    averageOpponentStackBb: 100,
  }));
  assert(premiumOpen.actionType === "raise", "AA unopened should raise, not limp or jam deep");
  assert((premiumOpen.amount || 0) < 50, "AA deep unopened should not choose a jam-sized raise");

  const akVsOpen = withFixedRandom(() => decideBotAction({
    personality: "TAG",
    holeCards: ["As", "Ks"],
    boardCards: [],
    pot: 9,
    currentBet: 6,
    streetContribution: 0,
    stackEnd: 200,
    bigBlind: 2,
    street: "preflop",
    seatNo: 5,
    buttonSeat: 2,
    totalSeats: 6,
    activeSeatCount: 6,
    wasAggressor: false,
    streetAggressionCount: 1,
    preflopLimperCount: 0,
    effectiveStackBb: 100,
    startingStackBb: 100,
    averageOpponentStackBb: 100,
  }));
  assert(akVsOpen.actionType !== "all_in", "AK deep versus a single open should not jam by default");

  const ninesVsThreeBet = withFixedRandom(() => decideBotAction({
    personality: "TAG",
    holeCards: ["9s", "9d"],
    boardCards: [],
    pot: 27,
    currentBet: 18,
    streetContribution: 6,
    stackEnd: 188,
    bigBlind: 2,
    street: "preflop",
    seatNo: 6,
    buttonSeat: 2,
    totalSeats: 6,
    activeSeatCount: 6,
    wasAggressor: true,
    streetAggressionCount: 2,
    preflopLimperCount: 0,
    effectiveStackBb: 97,
    startingStackBb: 100,
    averageOpponentStackBb: 100,
  }));
  assert(
    ninesVsThreeBet.actionType === "call" || ninesVsThreeBet.actionType === "fold",
    "99 deep versus a 3-bet should call or fold, not punt all-in"
  );

  const shortPremium = withFixedRandom(() => decideBotAction({
    personality: "LAG",
    holeCards: ["As", "Kd"],
    boardCards: [],
    pot: 9,
    currentBet: 6,
    streetContribution: 0,
    stackEnd: 16,
    bigBlind: 2,
    street: "preflop",
    seatNo: 3,
    buttonSeat: 1,
    totalSeats: 6,
    activeSeatCount: 4,
    wasAggressor: false,
    streetAggressionCount: 1,
    preflopLimperCount: 0,
    effectiveStackBb: 8,
    startingStackBb: 100,
    averageOpponentStackBb: 55,
  }));
  assert(shortPremium.actionType === "all_in", "Short premium hands should still jam when stack depth makes it logical");

  const topPairFlop = withFixedRandom(() => decideBotAction({
    personality: "TAG",
    holeCards: ["Ah", "Kd"],
    boardCards: ["Ac", "7s", "2d"],
    pot: 14,
    currentBet: 0,
    streetContribution: 0,
    stackEnd: 180,
    bigBlind: 2,
    street: "flop",
    seatNo: 4,
    buttonSeat: 1,
    totalSeats: 6,
    activeSeatCount: 4,
    wasAggressor: true,
    effectiveStackBb: 90,
    startingStackBb: 100,
    averageOpponentStackBb: 70,
  }));
  assert(topPairFlop.actionType !== "all_in", "Medium-strength postflop value should not open-jam deep");

  const cheapRiverPrice = withFixedRandom(() => decideBotAction({
    personality: "TAG",
    holeCards: ["Qh", "8d"],
    boardCards: ["Qs", "7c", "4d", "Ks", "2h"],
    pot: 160,
    currentBet: 59,
    streetContribution: 50,
    stackEnd: 191,
    bigBlind: 2,
    street: "river",
    seatNo: 4,
    buttonSeat: 1,
    totalSeats: 6,
    activeSeatCount: 2,
    wasAggressor: false,
    effectiveStackBb: 95,
    startingStackBb: 100,
    averageOpponentStackBb: 100,
  }));
  assert(cheapRiverPrice.actionType === "call", "Bots should not fold a tiny river price with made-hand showdown value");
}

run();
console.log("bot engine tests passed");
