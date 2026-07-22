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
// jamShift, riskShift) plus `defendShift` -- an extra gamble factor for looking
// up preflop raises so aggressive characters create action instead of the whole
// table folding to one pot-size open. Values are ABSOLUTE (they replace the base
// field).
//
// `taunts` are short in-character table-talk lines the runtime may flash as a
// reaction bubble mid-hand (same channel as the human quick-chat emotes):
// `aggro` after the character bets/raises/jams big, `call` after it calls a big
// bet, `fold` after it folds to one. Optional; generic emoji cover the rest.

export type CharacterBase = "TAG" | "LAG" | "Rock" | "Station";

export type CharacterTaunt = { emoji: string; text: string };

export type CharacterStyle = {
  base: CharacterBase;
  profile?: Record<string, number>;
  preflop?: Record<string, number>;
  expressiveness?: number; // emote multiplier for bot_expression (1 = default)
  tiltProne?: boolean;     // loosens up when its OWN table image reads "tilting"
  taunts?: {
    aggro?: CharacterTaunt[];
    call?: CharacterTaunt[];
    fold?: CharacterTaunt[];
  };
};

export const CHARACTER_STYLES: Record<string, CharacterStyle> = {
  // Dandy Negranope -- friendly but deceptive, reads-heavy, hero-calls, traps.
  negranope: {
    base: "TAG",
    profile: { bluffRate: 0.08, callRate: 0.8, checkRaiseRate: 0.12 },
    preflop: { flatShift: 0.2, defendShift: 0.1 },
    expressiveness: 1.4,
    taunts: {
      aggro: [
        { emoji: "\u{1F4AC}", text: "Let me know?" },
        { emoji: "\u{1F60F}", text: "I've got a feeling about this one" },
      ],
      call: [{ emoji: "\u{1F919}", text: "I always pay to see" }],
      fold: [{ emoji: "\u{1F9E0}", text: "I know EXACTLY what you have" }],
    },
  },
  // Tommy Donk -- wild maniac, splash artist, chaos.
  donk: {
    base: "LAG",
    profile: { bluffRate: 0.26, callRate: 0.85, cbetRate: 0.9, raiseAbove: 0.42 },
    preflop: { openShift: 0.8, threeBetShift: 0.6, riskShift: 0.14, defendShift: 0.2 },
    expressiveness: 1.35,
    taunts: {
      aggro: [
        { emoji: "\u{1F4A3}", text: "donk bomb. sorry" },
        { emoji: "\u{1F937}", text: "i guess... all-in" },
      ],
      call: [{ emoji: "\u{1F3B2}", text: "probably bad. calling" }],
      fold: [{ emoji: "\u{1F634}", text: "eh" }],
    },
  },
  // Fedor Holes -- aggressive high-stakes, smug hero call-downs.
  holes: {
    base: "LAG",
    profile: { bluffRate: 0.14, callRate: 0.88, raiseAbove: 0.46 },
    preflop: { threeBetShift: 0.6, riskShift: 0.1, defendShift: 0.14 },
    expressiveness: 1.1,
    taunts: {
      aggro: [{ emoji: "\u{1F451}", text: "Pressure is a privilege" }],
      call: [{ emoji: "\u{1F60E}", text: "The smug call-down" }],
      fold: [{ emoji: "\u{1F4B8}", text: "Pocket change anyway" }],
    },
  },
  // Eye-Sack Haxxon -- GTO / solver, balanced, low adaptivity, cerebral.
  haxxon: {
    base: "TAG",
    profile: { bluffRate: 0.09, callRate: 0.72, raiseAbove: 0.6 },
    preflop: { defendShift: 0.06 },
    expressiveness: 0.7,
    taunts: {
      aggro: [{ emoji: "\u{1F9EE}", text: "Solver approved" }],
      call: [{ emoji: "⚖️", text: "Priced in" }],
      fold: [{ emoji: "\u{1F4C9}", text: "-EV. Pass." }],
    },
  },
  // Finn Eyev -- elite, fearless all-rounder, calm.
  eyev: {
    base: "TAG",
    profile: { bluffRate: 0.08, callRate: 0.74, raiseAbove: 0.58 },
    preflop: { threeBetShift: 0.15, defendShift: 0.08 },
    expressiveness: 0.9,
    taunts: {
      aggro: [{ emoji: "\u{1F9CA}", text: "Ice cold" }],
      call: [{ emoji: "\u{1F441}️", text: "I see you" }],
      fold: [{ emoji: "❄️", text: "Not this time" }],
    },
  },
  // Fill Hell's Mouth -- tight/value, berates the table, tilts when losing.
  hellsmouth: {
    base: "Rock",
    profile: { bluffRate: 0.02, callRate: 0.8 },
    preflop: { defendShift: 0.07 },
    expressiveness: 1.4,
    tiltProne: true,
    taunts: {
      aggro: [
        { emoji: "\u{1F30B}", text: "I'm the BEST in the world!" },
        { emoji: "\u{1F621}", text: "?!##!" },
      ],
      call: [{ emoji: "\u{1F3AD}", text: "I can dodge bullets, baby" }],
      fold: [{ emoji: "\u{1F92C}", text: "If it weren't for luck, I'd win them ALL" }],
    },
  },
  // Epic Sydell -- zen, disciplined, low-variance, quiet.
  sydell: {
    base: "TAG",
    profile: { bluffRate: 0.04, checkRaiseRate: 0.05 },
    preflop: { defendShift: 0.05 },
    expressiveness: 0.5,
    taunts: {
      aggro: [{ emoji: "\u{1F5FF}", text: "..." }],
      call: [{ emoji: "\u{1F9D8}", text: "Patience" }],
      fold: [{ emoji: "\u{1F343}", text: "Let it go" }],
    },
  },
  // Stew Hunger -- fearless aggressive genius, gamble-prone.
  hunger: {
    base: "LAG",
    profile: { bluffRate: 0.2, callRate: 0.82, raiseAbove: 0.46 },
    preflop: { threeBetShift: 0.55, riskShift: 0.1, defendShift: 0.16 },
    expressiveness: 1.1,
    taunts: {
      aggro: [
        { emoji: "⚡", text: "ALL GAS!" },
        { emoji: "☕", text: "One more cup, one more raise" },
      ],
      call: [{ emoji: "\u{1F525}", text: "I'm never folding" }],
      fold: [{ emoji: "\u{1F62C}", text: "Even I fold sometimes" }],
    },
  },
  // Cheap Grease -- value nit, only strong hands, predictable.
  grease: {
    base: "Rock",
    profile: { bluffRate: 0.0, callRate: 0.8, raiseAbove: 0.55, preflopFoldBelow: 0.58 },
    preflop: { openShift: -0.5, threeBetShift: -0.4, riskShift: -0.12, defendShift: 0.02 },
    expressiveness: 0.7,
    taunts: {
      aggro: [{ emoji: "\u{1F4B0}", text: "Value. Pure value." }],
      call: [{ emoji: "\u{1FAA4}", text: "Walked right into it" }],
      fold: [{ emoji: "\u{1F6D2}", text: "Too rich for me" }],
    },
  },
  // Pony Gee -- table-talk aggressor, relentless pressure, needles constantly.
  pony: {
    base: "LAG",
    profile: { bluffRate: 0.24, callRate: 0.86, cbetRate: 0.88, raiseAbove: 0.4 },
    preflop: { openShift: 0.7, threeBetShift: 0.75, jamShift: 0.1, riskShift: 0.13, defendShift: 0.17 },
    expressiveness: 1.5,
    taunts: {
      aggro: [
        { emoji: "\u{1F5E3}️", text: "CALL if you have the heart!" },
        { emoji: "\u{1F981}", text: "I'm gonna eat you alive!" },
      ],
      call: [{ emoji: "\u{1F608}", text: "You're playing with fire" }],
      fold: [{ emoji: "\u{1F3A4}", text: "Lucky. VERY lucky." }],
    },
  },
};

export function resolveCharacterStyle(characterId?: string | null): CharacterStyle | null {
  if (!characterId) return null;
  return CHARACTER_STYLES[characterId] || null;
}
