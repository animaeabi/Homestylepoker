// Extracted Geometry and Layout Functions
function isLandscape() {
  return window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
}

function getDealFlightPath(fromX, fromY, toX, toY, cardIndex = 1) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  const direction = Math.abs(dx) > 8 ? Math.sign(dx) : (Number(cardIndex || 1) % 2 === 0 ? 1 : -1);
  const arcLift = Math.max(24, Math.min(68, distance * 0.18));
  const sideDrift = Math.max(8, Math.min(22, Math.abs(dx) * 0.08 + 6)) * direction;
  const roundDrop = Number(cardIndex || 1) === 2 ? 5 : 0;
  const fromRot = direction >= 0 ? -20 : 18;
  const midRot = direction >= 0 ? -7 : 6;

  return {
    midX: fromX + dx * 0.54 + sideDrift,
    midY: fromY + dy * 0.46 - arcLift - roundDrop,
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
    { x: 6, y: 30 }, { x: 94, y: 30 },
    { x: 8, y: 75 }, { x: 92, y: 75 },
  ],
  6: [
    { x: 30, y: 4 }, { x: 70, y: 4 },
    { x: 4, y: 40 }, { x: 96, y: 40 },
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
    { x: 2, y: 38 }, { x: 98, y: 38 },
    { x: 2, y: 62 }, { x: 98, y: 62 },
    { x: 14, y: 88 }, { x: 86, y: 88 },
  ],
  10: [
    { x: 30, y: 3 }, { x: 70, y: 3 },
    { x: 6, y: 18 }, { x: 94, y: 18 },
    { x: 4, y: 40 }, { x: 96, y: 40 },
    { x: 4, y: 62 }, { x: 96, y: 62 },
    { x: 22, y: 82 }, { x: 78, y: 82 },
  ],
};

// Hand-tuned landscape slots (table seats only; my-seat remains in hand area).
// Goal: mirrored rows with no direct seat opposite hero.
const LANDSCAPE_SEATS = {
  1: [{ x: 36, y: 9 }],
  2: [{ x: 36, y: 9 }, { x: 64, y: 9 }],
  3: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 88, y: 27 }],
  4: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }],
  5: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 94, y: 56 }],
  6: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }],
  7: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }, { x: 80, y: 82 }],
  8: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }, { x: 20, y: 82 }, { x: 80, y: 82 }],
  9: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }, { x: 20, y: 82 }, { x: 80, y: 82 }, { x: 86, y: 86 }],
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
