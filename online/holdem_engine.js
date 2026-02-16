// Online Hold'em authoritative engine scaffold (M1).
// Not yet wired into UI. This file defines deterministic primitives used by server runtime in M2.

const STREETS = ["preflop", "flop", "turn", "river"];

export function buildDeck() {
  const deck = [];
  for (let suit = 0; suit < 4; suit += 1) {
    for (let rank = 2; rank <= 14; rank += 1) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function cryptoRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive must be a positive integer");
  }

  const g = globalThis.crypto;
  if (!g || typeof g.getRandomValues !== "function") {
    throw new Error("Missing cryptographic RNG");
  }

  const uint32Max = 0x1_0000_0000;
  const limit = uint32Max - (uint32Max % maxExclusive);
  const buf = new Uint32Array(1);

  while (true) {
    g.getRandomValues(buf);
    const x = buf[0];
    if (x < limit) return x % maxExclusive;
  }
}

export function shuffleDeck(deck, randInt = cryptoRandomInt) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createHandState({ handId, tableId, seats, smallBlind, bigBlind }) {
  return {
    handId,
    tableId,
    street: "preflop",
    actionSeat: null,
    buttonSeat: null,
    smallBlind,
    bigBlind,
    potTotal: 0,
    board: [],
    currentBet: 0,
    minRaise: bigBlind,
    seats: seats.map((seat) => ({
      seatNo: seat.seatNo,
      groupPlayerId: seat.groupPlayerId,
      stack: Number(seat.stack || 0),
      committedStreet: 0,
      committedTotal: 0,
      folded: false,
      allIn: false,
      actedThisStreet: false
    }))
  };
}

export function validateAction(state, action) {
  if (!state || !action) return { ok: false, reason: "missing_state_or_action" };
  const seat = state.seats.find((s) => s.seatNo === action.seatNo);
  if (!seat) return { ok: false, reason: "seat_not_found" };
  if (seat.folded) return { ok: false, reason: "seat_folded" };
  if (seat.allIn) return { ok: false, reason: "seat_all_in" };

  const toCall = Math.max(0, state.currentBet - seat.committedStreet);

  if (action.type === "fold") return { ok: true };
  if (action.type === "check") return toCall === 0 ? { ok: true } : { ok: false, reason: "cannot_check" };
  if (action.type === "call") return toCall > 0 ? { ok: true } : { ok: false, reason: "nothing_to_call" };

  if (action.type === "bet") {
    if (state.currentBet !== 0) return { ok: false, reason: "use_raise_not_bet" };
    if (action.amount < state.bigBlind) return { ok: false, reason: "bet_below_big_blind" };
    if (action.amount > seat.stack) return { ok: false, reason: "bet_exceeds_stack" };
    return { ok: true };
  }

  if (action.type === "raise") {
    if (state.currentBet === 0) return { ok: false, reason: "use_bet_not_raise" };
    const minTo = state.currentBet + state.minRaise;
    const raiseTo = Number(action.raiseTo || 0);
    if (raiseTo < minTo) return { ok: false, reason: "raise_below_min" };
    if (raiseTo - seat.committedStreet > seat.stack) return { ok: false, reason: "raise_exceeds_stack" };
    return { ok: true };
  }

  if (action.type === "all_in") {
    if (seat.stack <= 0) return { ok: false, reason: "no_stack" };
    return { ok: true };
  }

  return { ok: false, reason: "unsupported_action" };
}

export function nextStreet(street) {
  const idx = STREETS.indexOf(street);
  if (idx < 0 || idx >= STREETS.length - 1) return null;
  return STREETS[idx + 1];
}

export function computeSidePots(seats) {
  const sorted = seats
    .map((s) => ({ seatNo: s.seatNo, committedTotal: Number(s.committedTotal || 0), folded: !!s.folded }))
    .sort((a, b) => a.committedTotal - b.committedTotal);

  const pots = [];
  let prev = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i].committedTotal;
    if (tier <= prev) continue;

    const contributors = sorted.slice(i);
    const amount = (tier - prev) * contributors.length;
    const eligibleSeatNos = contributors.filter((s) => !s.folded).map((s) => s.seatNo);

    pots.push({ amount, eligibleSeatNos });
    prev = tier;
  }

  return pots;
}
