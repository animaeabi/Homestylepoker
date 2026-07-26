// Extracted Geometry and Layout Functions
function isLandscape() {
  return window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
}

function getDealFlightPath(fromX, fromY, toX, toY, cardIndex = 1) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  const direction = Math.abs(dx) > 8 ? Math.sign(dx) : (Number(cardIndex || 1) % 2 === 0 ? 1 : -1);
  const arcLift = Math.max(18, Math.min(42, distance * 0.12));
  const cardOffset = Number(cardIndex || 1) === 2 ? 4 : -2;
  const fromRot = direction >= 0 ? -14 : 12;
  const midRot = direction >= 0 ? -4 : 4;

  return {
    // Keep the hole-card flight magnetized to the target seat instead of
    // arcing outward past edge seats.
    midX: fromX + dx * 0.52,
    midY: fromY + dy * 0.48 - arcLift + cardOffset,
    fromRot,
    midRot,
  };
}

function getBoardRevealFlightPath(fromX, fromY, toX, toY, cardIndex = 1) {
  const dx = toX - fromX;
  const fromRot = dx >= 0 ? -4 : 4;
  return {
    // Hard magnetic landing: head directly to the exact slot.
    midX: toX,
    midY: toY,
    fromRot,
    midRot: 0,
    toRot: 0,
  };
}

// Fixed seat positions at the table edge for portrait mode.
// Each slot is { x%, y% } placing the seat right on the rail.
const PORTRAIT_SEATS = {
  2: [
    { x: 50, y: 4 }, { x: 50, y: 86 },
  ],
  3: [
    { x: 50, y: 4 },
    { x: 8, y: 44 }, { x: 92, y: 44 },
  ],
  4: [
    { x: 30, y: 4 }, { x: 70, y: 4 },
    { x: 8, y: 52 }, { x: 92, y: 52 },
  ],
  5: [
    { x: 50, y: 4 },
    { x: 10, y: 30 }, { x: 90, y: 30 },
    { x: 8, y: 75 }, { x: 92, y: 75 },
  ],
  6: [
    { x: 30, y: 4 }, { x: 70, y: 4 },
    { x: 10, y: 40 }, { x: 90, y: 40 },
    { x: 20, y: 80 }, { x: 80, y: 80 },
  ],
  7: [
    { x: 50, y: 3 },
    { x: 12, y: 16 }, { x: 88, y: 16 },
    { x: 11, y: 45 }, { x: 89, y: 45 },
    { x: 10, y: 85 }, { x: 90, y: 85 },
  ],
  8: [
    { x: 30, y: 2 }, { x: 70, y: 2 },
    { x: 11, y: 25 }, { x: 89, y: 25 },
    { x: 12, y: 62 }, { x: 88, y: 62 },
    { x: 18, y: 90 }, { x: 82, y: 90 },
  ],
  9: [
    { x: 50, y: 2 },
    { x: 12, y: 13 }, { x: 88, y: 13 },
    { x: 10, y: 38 }, { x: 90, y: 38 },
    { x: 10, y: 62 }, { x: 90, y: 62 },
    { x: 14, y: 88 }, { x: 86, y: 88 },
  ],
  10: [
    { x: 30, y: 3 }, { x: 70, y: 3 },
    { x: 10, y: 18 }, { x: 90, y: 18 },
    { x: 10, y: 40 }, { x: 90, y: 40 },
    { x: 10, y: 62 }, { x: 90, y: 62 },
    { x: 22, y: 82 }, { x: 78, y: 82 },
  ],
};

// Hand-tuned landscape slots (table seats only; my-seat remains in hand area).
// Casino composition: every slot sits ON the elliptical rail (the seats-layer
// spans the table surface, so these are points on the oval's edge) -- players
// straddle the rim like at a real table, never float inside the felt. Bottom
// center stays clear for the hero.
const LANDSCAPE_SEATS = {
  1: [{ x: 50, y: 1 }],
  2: [{ x: 35, y: 3 }, { x: 65, y: 3 }],
  3: [{ x: 50, y: 1 }, { x: 13, y: 15 }, { x: 87, y: 15 }],
  4: [{ x: 35, y: 3 }, { x: 65, y: 3 }, { x: 7, y: 30 }, { x: 93, y: 30 }],
  5: [{ x: 50, y: 1 }, { x: 16, y: 11 }, { x: 84, y: 11 }, { x: 4, y: 46 }, { x: 96, y: 46 }],
  6: [{ x: 35, y: 3 }, { x: 65, y: 3 }, { x: 8, y: 24 }, { x: 92, y: 24 }, { x: 5, y: 60 }, { x: 95, y: 60 }],
  7: [{ x: 35, y: 3 }, { x: 65, y: 3 }, { x: 8, y: 24 }, { x: 92, y: 24 }, { x: 5, y: 58 }, { x: 95, y: 58 }, { x: 78, y: 90 }],
  8: [{ x: 35, y: 3 }, { x: 65, y: 3 }, { x: 8, y: 24 }, { x: 92, y: 24 }, { x: 5, y: 58 }, { x: 95, y: 58 }, { x: 22, y: 90 }, { x: 78, y: 90 }],
  9: [{ x: 50, y: 1 }, { x: 22, y: 6 }, { x: 78, y: 6 }, { x: 6, y: 28 }, { x: 94, y: 28 }, { x: 4, y: 60 }, { x: 96, y: 60 }, { x: 24, y: 90 }, { x: 76, y: 90 }],
};

function portraitSeatTemplate(total) {
  const clamped = Math.max(2, Math.min(10, total));
  const positions = PORTRAIT_SEATS[clamped] || PORTRAIT_SEATS[6];
  return positions.slice(0, Math.max(1, total));
}

function landscapeSeatTemplate(total) {
  const clamped = Math.max(1, Math.min(9, total));
  const positions = LANDSCAPE_SEATS[clamped] || LANDSCAPE_SEATS[8];
  return positions.slice(0, Math.max(1, total));
}

function compactSeatTemplate(total) {
  return isLandscape() ? landscapeSeatTemplate(total) : portraitSeatTemplate(total);
}

function compactClockwiseSortKey(position) {
  const angle = Math.atan2(position.y - 50, position.x - 50);
  return (Math.PI / 2 - angle + Math.PI * 2) % (Math.PI * 2);
}

function compactSlotOrder(total) {
  return compactSeatTemplate(total)
    .map((position, index) => ({ index, sortKey: compactClockwiseSortKey(position) }))
    .sort((a, b) => a.sortKey - b.sortKey || a.index - b.index)
    .map(({ index }) => index);
}

function compactSeatsFromHeroPerspective(seats, mySeat) {
  if (!mySeat) return seats.slice();
  const myIdx = seats.findIndex((seat) => seat.seat_no === mySeat.seat_no);
  if (myIdx < 0) return seats.slice();
  return seats.slice(myIdx + 1).concat(seats.slice(0, myIdx));
}

function portraitSeatPosition(index, total) {
  const positions = portraitSeatTemplate(total);
  const idx = Math.max(0, Math.min(index - 1, positions.length - 1));
  const p = positions[idx];
  return { x: `${p.x}%`, y: `${p.y}%` };
}

function landscapeSeatPosition(index, total) {
  const positions = landscapeSeatTemplate(total);
  const idx = Math.max(0, Math.min(index - 1, positions.length - 1));
  const p = positions[idx];
  return { x: `${p.x}%`, y: `${p.y}%` };
}

function isPortraitMobile() {
  return window.innerWidth <= 768 && window.innerHeight > window.innerWidth;
}

function isCompactMobileLayout() {
  return isPortraitMobile() || isLandscape();
}

function seatPosition(index, total) {
  const landscape = isLandscape();
  const portrait = isPortraitMobile();
  const angle = Math.PI / 2 + ((index - 1) / total) * Math.PI * 2;
  let xR, yR;
  if (landscape) {
    return landscapeSeatPosition(index, total);
  } else if (portrait) {
    return portraitSeatPosition(index, total);
  } else if (window.innerWidth <= 768) {
    xR = total >= 8 ? 39 : 37;
    yR = total >= 8 ? 40 : 38;
  } else {
    xR = 41;
    yR = 37;
  }
  return { x: `${50 + Math.cos(angle) * xR}%`, y: `${50 - Math.sin(angle) * yR}%` };
}
