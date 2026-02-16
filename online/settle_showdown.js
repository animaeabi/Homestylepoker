import { resolveShowdownPayouts } from "./showdown.js";

// Convert a hand-state payload (from online_get_hand_state) into settle payloads.
export function buildShowdownPayoutsFromHandState(handState) {
  const hand = handState?.hand || {};
  const players = (handState?.players || []).map((p) => ({
    seatNo: p.seat_no,
    folded: !!p.folded,
    committed: Number(p.committed || 0),
    holeCards: Array.isArray(p.hole_cards) ? p.hole_cards : []
  }));

  return resolveShowdownPayouts({
    boardCards: Array.isArray(hand.board_cards) ? hand.board_cards : [],
    players
  });
}

export async function settleShowdownFromState({
  onlineClient,
  handId,
  actorGroupPlayerId = null,
  note = "auto_showdown_resolution"
}) {
  const state = await onlineClient.getHandState({ handId, sinceSeq: null });
  const payouts = buildShowdownPayoutsFromHandState(state);
  if (!payouts.length) {
    throw new Error("No payouts computed from showdown state.");
  }
  return onlineClient.settleShowdown({
    handId,
    payouts,
    actorGroupPlayerId,
    note
  });
}
