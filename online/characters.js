// Signature bot characters -- client display roster.
//
// Fixed roster of parody poker-pro characters. Each bot at a table IS one of
// these (see addBot -> pickNextCharacter). This module is DISPLAY ONLY: id,
// parody name, title, a spoiler-free flavor trait, and asset paths for the
// round table avatar + the tap-to-view flavor card. The play style that each
// character actually plays with lives server-side in
// supabase/functions/_shared/characters.ts, keyed by the same id -- it is NOT
// shipped to the client, so tapping a character never reveals strategy.
//
// `avatar`  -> round portrait crop rendered in the seat (falls back to initials
//              if the image is missing, so this is safe to ship before art lands).
// `flavorCard` -> the card art cropped ABOVE the strategy rows, shown in the
//              character-card modal. Same reason it is the crop, not the raw card:
//              the strategy text is baked into the full card, so we never show it.

const CARD_DIR = "assets/characters/cards_flavor";
const AVATAR_DIR = "assets/characters/avatars";

// Order here is the assignment order for a table (pickNextCharacter walks it).
export const CHARACTERS = [
  {
    id: "negranope",
    name: "Dandy Negranope",
    title: "The People's Champ",
    trait: "All smiles and small talk -- reads your soul while asking about your weekend.",
  },
  {
    id: "donk",
    name: "Tommy Donk",
    title: "The Splash Machine",
    trait: "Never met a pot he didn't want to blow up. Chaos is the strategy.",
  },
  {
    id: "holes",
    name: "Fedor Holes",
    title: "The High-Stakes Assassin",
    trait: "Ice-cold nosebleed grinder. Plays for more than you make in a year.",
  },
  {
    id: "haxxon",
    name: "Eye-Sack Haxxon",
    title: "The Solver",
    trait: "Runs the numbers in his head. Balanced to a fault, unbothered by tilt.",
  },
  {
    id: "eyev",
    name: "Finn Eyev",
    title: "The Phenom",
    trait: "Silky smooth and utterly fearless. Makes the impossible fold look easy.",
  },
  {
    id: "hellsmouth",
    name: "Fill Hell's Mouth",
    title: "The Poker Brat",
    trait: "Wins with elegance, loses with fireworks. Will tell you all about it.",
  },
  {
    id: "sydell",
    name: "Epic Sydell",
    title: "The Zen Master",
    trait: "Calm, quiet, endless. Grinds you down without ever changing expression.",
  },
  {
    id: "hunger",
    name: "Stew Hunger",
    title: "The Comeback Kid",
    trait: "Pure gamble, pure genius. Down to the felt one hand, chip leader the next.",
  },
  {
    id: "grease",
    name: "Cheap Grease",
    title: "The Nit",
    trait: "Folds all day, then shows you the nuts. If he bets, you're already beat.",
  },
];

// Fill in asset paths from the id so we never drift the strings apart.
for (const c of CHARACTERS) {
  c.avatar = `${AVATAR_DIR}/${c.id}.png`;
  c.flavorCard = `${CARD_DIR}/${c.id}.png`;
}

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export function getCharacter(id) {
  if (!id) return null;
  return BY_ID.get(id) || null;
}

// Pick the next character not already used at this table. `usedIds` is any
// iterable of character ids currently seated. Falls back to a deterministic
// rotation once the roster is exhausted (tables with more bot seats than
// characters), so repeats are spread out rather than clumped.
export function pickNextCharacter(usedIds) {
  const used = new Set(usedIds || []);
  for (const c of CHARACTERS) {
    if (!used.has(c.id)) return c;
  }
  // Roster exhausted -- rotate by how many are seated.
  return CHARACTERS[used.size % CHARACTERS.length];
}
