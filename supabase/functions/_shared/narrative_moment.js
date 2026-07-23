const IMMEDIATE = "immediate";
const CALLBACK = "callback";
const MEMORY_ONLY = "memory_only";

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

export function freezeNarrativeMoment(input = {}, options = {}) {
  const now = numberOr(options.now ?? input.createdAt, Date.now());
  const immediateMs = Math.max(0, numberOr(options.immediateMs, 12_000));
  const callbackMs = Math.max(immediateMs, numberOr(options.callbackMs, 90_000));
  const packet = {
    version: 1,
    sourceHandId: cleanText(input.sourceHandId, 96) || null,
    sourceEventSeq: Math.max(0, Math.floor(numberOr(input.sourceEventSeq, 0))),
    sourcePhase: cleanText(input.sourcePhase, 48) || "unknown",
    momentType: cleanText(input.momentType, 64) || "table_moment",
    createdAt: now,
    immediateUntil: numberOr(input.immediateUntil, now + immediateMs),
    callbackUntil: numberOr(input.callbackUntil, now + callbackMs),
    callbackEligible: input.callbackEligible !== false,
    street: cleanText(input.street, 16) || null,
    potBb: Math.max(0, numberOr(input.potBb, 0)),
    actor: cloneValue(input.actor || null),
    opponent: cloneValue(input.opponent || null),
    result: cloneValue(input.result || null),
    board: Array.isArray(input.board) ? input.board.map((card) => cleanText(card, 4)).filter(Boolean).slice(0, 5) : [],
    contextSummary: cleanText(input.contextSummary, 180) || "the previous poker moment",
  };
  return deepFreeze(packet);
}

export function narrativeMomentPrompt(moment) {
  if (!moment?.sourceHandId) return "";
  const facts = {
    sourceHandId: moment.sourceHandId,
    sourceEventSeq: moment.sourceEventSeq,
    sourcePhase: moment.sourcePhase,
    momentType: moment.momentType,
    street: moment.street,
    potBb: moment.potBb,
    actor: moment.actor,
    opponent: moment.opponent,
    result: moment.result,
    board: moment.board,
    contextSummary: moment.contextSummary,
  };
  return [
    "FROZEN HAND MOMENT — these facts were captured before generation and cannot change.",
    "React only to this exact moment. Do not borrow cards, actions, winners, or stakes from a later hand.",
    JSON.stringify(facts),
  ].join("\n");
}

export function withNarrativeMoment(situation, moment) {
  const block = narrativeMomentPrompt(moment);
  const base = String(situation || "").trim();
  return block ? `${base}\n\n${block}` : base;
}

export function classifyNarrativeDelivery({
  moment,
  currentHand = null,
  currentHasAction = false,
  now = Date.now(),
} = {}) {
  if (!moment?.sourceHandId) return IMMEDIATE;
  const sourceHandId = String(moment.sourceHandId);
  const currentHandId = currentHand?.id ? String(currentHand.id) : null;
  const currentState = String(currentHand?.state || "").toLowerCase();
  const sameHand = Boolean(currentHandId && currentHandId === sourceHandId);

  if (sameHand && now <= numberOr(moment.immediateUntil, 0)) return IMMEDIATE;
  if (moment.callbackEligible === false || now > numberOr(moment.callbackUntil, 0)) return MEMORY_ONLY;

  const sourceResultStillShowing = sameHand && ["showdown", "settled", "canceled"].includes(currentState);
  const genuinelyBetweenHands = !currentHandId;
  const nextHandOpening = Boolean(
    currentHandId
      && !sameHand
      && currentState === "preflop"
      && !currentHasAction
  );

  if (sourceResultStillShowing || genuinelyBetweenHands || nextHandOpening) return CALLBACK;
  return MEMORY_ONLY;
}

export function reframeNarrativeCallback(moment, text) {
  const summary = cleanText(moment?.contextSummary, 180) || "that last hand";
  const cleaned = cleanText(text, 220)
    .replace(/\bjust\b/gi, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  const lead = String(moment?.sourcePhase || "").startsWith("settle")
    ? `I'm still thinking about ${summary}.`
    : `Back on ${summary}:`;
  return cleanText(`${lead} ${cleaned}`, 240);
}

export function prepareNarrativeDelivery({
  moment,
  text,
  mood = null,
  currentHand = null,
  currentHasAction = false,
  now = Date.now(),
} = {}) {
  const mode = classifyNarrativeDelivery({ moment, currentHand, currentHasAction, now });
  const meta = moment?.sourceHandId ? {
    sourceHandId: moment.sourceHandId,
    sourceEventSeq: moment.sourceEventSeq || 0,
    sourcePhase: moment.sourcePhase || null,
    momentType: moment.momentType || null,
    momentCreatedAt: moment.createdAt || null,
    deliveryMode: mode,
  } : { deliveryMode: mode };
  if (mode === MEMORY_ONLY) return { mode, text: "", mood: null, meta };
  if (mode === CALLBACK) {
    return { mode, text: reframeNarrativeCallback(moment, text), mood: "callback", meta };
  }
  return { mode, text: cleanText(text, 240), mood, meta };
}

export const NARRATIVE_DELIVERY = Object.freeze({ IMMEDIATE, CALLBACK, MEMORY_ONLY });
