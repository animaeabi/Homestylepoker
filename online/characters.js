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
    title: "The Chatterbox Soul-Reader",
    trait: "Friendly and endlessly talkative -- reads your soul through conversation.",
  },
  {
    id: "donk",
    name: "Tommy Donk",
    title: "The Donk Bomb Specialist",
    trait: "Aggressive bluffing and chaos-driven actions. A wild, unpredictable splash artist.",
  },
  {
    id: "holes",
    name: "Fedor Holes",
    title: "The High-Roller Luxury Squeezer",
    trait: "A smug high-roller living the luxurious life. Aggressive with high stakes.",
  },
  {
    id: "haxxon",
    name: "Eye-Sack Haxxon",
    title: "The GTO Math Menace",
    trait: "A mathematical approach powered by pure GTO strategy. Balanced to a fault.",
  },
  {
    id: "eyev",
    name: "Finn Eyev",
    title: "The Frost-Heart Bluffer",
    trait: "Looks like he plays like winter itself. Calculated, cold power poker.",
  },
  {
    id: "hellsmouth",
    name: "Fill Hell's Mouth",
    title: "The Table Tantrum Titan",
    trait: "Loud and emotional -- believes every card is a personal attack.",
  },
  {
    id: "sydell",
    name: "Epic Sydell",
    title: "The Stone Statue Grinder",
    trait: "A calm appearance hiding immense internal focus. Deliberate and methodical.",
  },
  {
    id: "hunger",
    name: "Stew Hunger",
    title: "The Hyper Caffeine Genius",
    trait: "A card prodigy running on high-octane energy. Jittery and relentless.",
  },
  {
    id: "grease",
    name: "Cheap Grease",
    title: "The Greasy Trap-Layer",
    trait: "A patient grinder who counts every chip. Value-focused and patient.",
  },
  {
    id: "pony",
    name: "Pony Gee",
    title: "The Table Talk Aggressor",
    trait: "A relentless verbal warrior with soul-crushing table talk. A hyper-aggressive verbal general.",
  },
];

// Fill in asset paths from the id so we never drift the strings apart.
for (const c of CHARACTERS) {
  c.avatar = `${AVATAR_DIR}/${c.id}.jpg`;
  c.flavorCard = `${CARD_DIR}/${c.id}.jpg`;
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
