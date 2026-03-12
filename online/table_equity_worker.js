import { resolveShowdownPayouts } from "./showdown.js?v=175";

const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const SUITS = ["S","H","D","C"];
const FULL_DECK = SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));

function normCard(token) {
  const v = String(token || "").trim().toUpperCase();
  if (v.length !== 2) return null;
  if (!RANKS.includes(v[0]) || !SUITS.includes(v[1])) return null;
  return v;
}

self.onmessage = function(e) {
  const { reqId, reqKey, reqTableId, hand, handPlayers } = e.data || {};
  const eq = calcEquity(hand, handPlayers);
  if (eq) {
    self.postMessage({
      reqId,
      reqKey: reqKey || "",
      reqTableId: reqTableId || null,
      equityResult: Array.from(eq.entries()),
    });
  }
};

function calcEquity(hand, handPlayers) {
  const contenders = (handPlayers || [])
    .filter(hp => !hp.folded && Array.isArray(hp.hole_cards) && hp.hole_cards.length === 2)
    .map(hp => ({ seatNo: hp.seat_no, holeCards: hp.hole_cards.map(normCard).filter(Boolean) }))
    .filter(hp => hp.holeCards.length === 2);
  if (contenders.length < 2) return new Map();

  const boardKnown = (hand?.board_cards || []).map(normCard).filter(Boolean);
  const unknownCount = Math.max(0, 5 - boardKnown.length);
  const knownSet = new Set(boardKnown);
  for (const hp of handPlayers || []) {
    if (Array.isArray(hp.hole_cards)) hp.hole_cards.forEach(t => { const c = normCard(t); if (c) knownSet.add(c); });
  }
  const deck = FULL_DECK.filter(t => !knownSet.has(t));
  const eq = new Map(contenders.map(p => [p.seatNo, 0]));
  let trials = 0;

  const run = (board) => {
    const payouts = resolveShowdownPayouts({
      boardCards: board,
      players: contenders.map(p => ({ seatNo: p.seatNo, folded: false, committed: 1, holeCards: p.holeCards }))
    });
    for (const po of payouts) eq.set(po.seat_no, (eq.get(po.seat_no) || 0) + po.amount / contenders.length);
    trials++;
  };

  if (unknownCount === 0) { run(boardKnown); }
  else if (unknownCount <= 2) {
    for (let i = 0; i < deck.length; i++) {
      if (unknownCount === 1) { run([...boardKnown, deck[i]]); }
      else { for (let j = i + 1; j < deck.length; j++) run([...boardKnown, deck[i], deck[j]]); }
    }
  } else {
    for (let n = 0; n < 600; n++) {
      const shuffled = deck.slice();
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      run([...boardKnown, ...shuffled.slice(0, unknownCount)]);
    }
  }

  const pct = new Map();
  for (const [seat, units] of eq) {
    pct.set(seat, trials > 0 ? Number(((units / trials) * 100).toFixed(1)) : 0);
  }
  return pct;
}
