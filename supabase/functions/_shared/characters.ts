// Signature bot characters -> play styles (server side).
//
// Each character maps to a base personality (TAG/LAG/Rock/Station) plus absolute
// overrides onto the engine's PROFILE and PREFLOP_STYLE knobs, so a bot actually
// PLAYS like its card -- Tommy Donk splashes, Cheap Grease nits, etc. The runtime
// reads online_table_seats.bot_character, resolves it here, and feeds the base +
// overrides into decideBotAction. Display data (name/title/portrait) lives on the
// client (online/characters.js); this module is the play-style source of truth.
//
// `profile` keys are fields of PROFILES[base] (bluffRate, callRate, raiseAbove,
// cbetRate, checkRaiseRate, preflopFoldBelow, postflopFoldBelow). `preflop` keys
// are fields of PREFLOP_STYLE[base] (openShift, flatShift, threeBetShift,
// jamShift, riskShift). Values are ABSOLUTE (they replace the base field).

export type CharacterBase = "TAG" | "LAG" | "Rock" | "Station";

export type CharacterStyle = {
  base: CharacterBase;
  profile?: Record<string, number>;
  preflop?: Record<string, number>;
  expressiveness?: number; // emote multiplier for bot_expression (1 = default)
  tiltProne?: boolean;     // loosens up when its OWN table image reads "tilting"
};

export const CHARACTER_STYLES: Record<string, CharacterStyle> = {
  // Dandy Negranope -- friendly but deceptive, reads-heavy, hero-calls, traps.
  negranope: {
    base: "TAG",
    profile: { bluffRate: 0.08, callRate: 0.8, checkRaiseRate: 0.12 },
    preflop: { flatShift: 0.2 },
    expressiveness: 1.4,
  },
  // Tommy Donk -- wild maniac, splash artist, chaos.
  donk: {
    base: "LAG",
    profile: { bluffRate: 0.26, callRate: 0.85, cbetRate: 0.9, raiseAbove: 0.42 },
    preflop: { openShift: 0.8, threeBetShift: 0.6, riskShift: 0.14 },
    expressiveness: 1.35,
  },
  // Fedor Holes -- aggressive high-stakes, smug hero call-downs.
  holes: {
    base: "LAG",
    profile: { bluffRate: 0.14, callRate: 0.88, raiseAbove: 0.46 },
    preflop: { threeBetShift: 0.6, riskShift: 0.1 },
    expressiveness: 1.1,
  },
  // Eye-Sack Haxxon -- GTO / solver, balanced, low adaptivity, cerebral.
  haxxon: {
    base: "TAG",
    profile: { bluffRate: 0.09, callRate: 0.72, raiseAbove: 0.6 },
    expressiveness: 0.7,
  },
  // Finn Eyev -- elite, fearless all-rounder, calm.
  eyev: {
    base: "TAG",
    profile: { bluffRate: 0.08, callRate: 0.74, raiseAbove: 0.58 },
    preflop: { threeBetShift: 0.15 },
    expressiveness: 0.9,
  },
  // Fill Hell's Mouth -- tight/value, berates the table, tilts when losing.
  hellsmouth: {
    base: "Rock",
    profile: { bluffRate: 0.02, callRate: 0.8 },
    expressiveness: 1.4,
    tiltProne: true,
  },
  // Epic Sydell -- zen, disciplined, low-variance, quiet.
  sydell: {
    base: "TAG",
    profile: { bluffRate: 0.04, checkRaiseRate: 0.05 },
    expressiveness: 0.5,
  },
  // Stew Hunger -- fearless aggressive genius, gamble-prone.
  hunger: {
    base: "LAG",
    profile: { bluffRate: 0.2, callRate: 0.82, raiseAbove: 0.46 },
    preflop: { threeBetShift: 0.55, riskShift: 0.1 },
    expressiveness: 1.1,
  },
  // Cheap Grease -- value nit, only strong hands, predictable.
  grease: {
    base: "Rock",
    profile: { bluffRate: 0.0, callRate: 0.8, raiseAbove: 0.55, preflopFoldBelow: 0.58 },
    preflop: { openShift: -0.5, threeBetShift: -0.4, riskShift: -0.12 },
    expressiveness: 0.7,
  },
  // Pony Gee -- table-talk aggressor, relentless pressure, needles constantly.
  pony: {
    base: "LAG",
    profile: { bluffRate: 0.24, callRate: 0.86, cbetRate: 0.88, raiseAbove: 0.4 },
    preflop: { openShift: 0.7, threeBetShift: 0.75, jamShift: 0.1, riskShift: 0.13 },
    expressiveness: 1.5,
  },
};

export function resolveCharacterStyle(characterId?: string | null): CharacterStyle | null {
  if (!characterId) return null;
  return CHARACTER_STYLES[characterId] || null;
}
