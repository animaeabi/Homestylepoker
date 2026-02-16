import assert from "node:assert/strict";
import { resolveShowdownPayouts } from "./showdown.js";

function run() {
  // Royal flush beats all.
  const payouts1 = resolveShowdownPayouts({
    boardCards: ["AS", "KS", "QS", "2D", "3C"],
    players: [
      { seatNo: 1, folded: false, committed: 100, holeCards: ["JS", "TS"] }, // royal
      { seatNo: 2, folded: false, committed: 100, holeCards: ["AH", "AD"] } // trips
    ]
  });
  assert.deepEqual(payouts1, [{ seat_no: 1, amount: 200 }]);

  // Side-pot split test.
  const payouts2 = resolveShowdownPayouts({
    boardCards: ["2S", "3S", "4S", "8D", "9C"],
    players: [
      { seatNo: 1, folded: false, committed: 100, holeCards: ["AS", "KS"] }, // nut flush
      { seatNo: 2, folded: false, committed: 50, holeCards: ["AH", "AD"] }, // pair
      { seatNo: 3, folded: false, committed: 100, holeCards: ["QS", "JS"] } // lower flush
    ]
  });
  const total2 = payouts2.reduce((sum, p) => sum + p.amount, 0);
  assert.equal(Number(total2.toFixed(2)), 250);
  assert.equal(payouts2.find((p) => p.seat_no === 1)?.amount > 0, true);

  console.log("showdown tests passed");
}

run();
