// Character table-chat banter (server side).
//
// Short, in-character chat lines the runtime posts AS the bots into the real
// table chat: bullying a live opponent by name after a big raise, gloating or
// grumbling at settle, and quick bot-to-bot comebacks so the table argues with
// itself. All lines are PARODY flavor inspired by the characters' public
// personas -- never quotes. `{name}` is replaced with the target player's name.
//
// Probabilities live at the call site; this module just serves lines. Keep
// every line comfortably under the chat's 180-char limit.

export type BanterContext = "bully" | "win" | "lose" | "bigCall" | "bigFold";

type LineBank = Partial<Record<BanterContext, string[]>> & {
  comeback?: string[]; // reply about another character; {name} = who spoke
};

const BANKS: Record<string, LineBank> = {
  negranope: {
    bully: [
      "{name}, I'll tell you exactly what you have... and it's no good. Fold.",
      "Wanna hear a secret, {name}? This is the one hand you should let go.",
      "{name} buddy, I like you too much to take all your chips. Almost.",
    ],
    win: ["What can I say, I just KNOW things.", "Told you I had it. I always tell you!"],
    lose: ["Wow. WOW. Nice hand I guess.", "I knew it and I still paid you. Classic me."],
    bigCall: ["I read souls for a living, let's see it."],
    bigFold: ["You had exactly king-queen. Don't tell me. I know."],
    comeback: ["{name}, tell us how you REALLY feel.", "And people say I talk too much... {name} exists."],
  },
  donk: {
    bully: [
      "{name} DODGE THIS!!!",
      "BIG BET FOR {name}!!! What you gonna dooo?",
      "Fold {name}, my cards are ON FIRE (maybe) (maybe not)",
    ],
    win: ["BOOM!!! DONK BOMBS EVERYWHERE!!!", "CHAOS WINS AGAIN!!!"],
    lose: ["Rebuy!!! Who sells chips!!!", "That was part of the plan. The plan is chaos."],
    bigCall: ["I call because folding is BORING"],
    bigFold: ["Even a bomb needs a break."],
    comeback: ["LOUD NOISES, {name}!!!", "{name} said words! I say BOOM!"],
  },
  holes: {
    bully: [
      "{name}, I've tipped more than your stack. Proceed carefully.",
      "This pot is lunch money, {name}, but I still want it.",
    ],
    win: ["Another one for the yacht fund.", "Standard. Utterly standard."],
    lose: ["Cute. Enjoy my pocket change.", "Variance is a tax on the poor. And apparently me."],
    bigCall: ["The smug call-down, as advertised."],
    bigFold: ["Not worth the jet fuel."],
    comeback: ["{name}, shouting is free, chips are not.", "Adorable energy, {name}."],
  },
  haxxon: {
    bully: [
      "{name}, the solver puts your range at 12% here. Just saying.",
      "Mathematically, {name}, this is where you fold. I ran it twice.",
    ],
    win: ["EV realized. Nothing personal.", "The spreadsheet never lies."],
    lose: ["Within one standard deviation. I'm fine. FINE."],
    bigCall: ["Pot odds say call. I am but a vessel."],
    bigFold: ["Negative EV. Discarded."],
    comeback: ["{name}, that outburst was -EV.", "Fascinating tilt pattern, {name}. Logging it."],
  },
  eyev: {
    bully: [
      "{name}. Look at me. Now look at your cards. Fold.",
      "I already know, {name}. The question is when you'll admit it.",
    ],
    win: ["As expected.", "Cold. Like winter."],
    lose: ["Noted."],
    bigCall: ["Show me."],
    bigFold: ["Patience."],
    comeback: ["{name} talks. I collect.", "Volume is not a strategy, {name}."],
  },
  hellsmouth: {
    bully: [
      "{name} honey, you are about to make a LEGENDARY mistake.",
      "Is {name} really thinking about calling ME? Unbelievable. UNBELIEVABLE.",
      "I've won more trophies than {name} has played hands. Fold, sweetie.",
    ],
    win: ["THAT'S why I'm the best in the world, baby!", "I can dodge bullets, baby!!"],
    lose: [
      "If it weren't for luck, I'd win every single one!!",
      "UNBELIEVABLE. This table is a circus and I'm the only professional.",
    ],
    bigCall: ["Fine. FINE. I call. Someone has to police this table."],
    bigFold: ["I fold. GREAT laydown. Write it down, that's a world-class fold."],
    comeback: ["Oh {name} is talking again. Cute. Nineteen trophies, {name}. NINETEEN.", "Honey, {name}, the adults are playing."],
  },
  sydell: {
    bully: ["{name}, peace is one fold away.", "Breathe, {name}. Then fold."],
    win: ["The river flows where it must."],
    lose: ["So it goes."],
    bigCall: ["Balance."],
    bigFold: ["Attachment causes suffering."],
    comeback: ["...", "{name}, stillness would serve you."],
  },
  hunger: {
    bully: [
      "Speed round, {name} — in or out?! CLOCK'S TICKING!",
      "{name} I've had four espressos and a dream. DON'T test me.",
    ],
    win: ["ELECTRIC! Rack 'em again!", "That's the caffeine talking and it says GG!"],
    lose: ["Whatever, next hand, LET'S GO, deal faster!"],
    bigCall: ["Never folding, never sleeping!"],
    bigFold: ["Ugh FINE. One fold. ONE."],
    comeback: ["{name} talks slow. Play FASTER!", "More action, less speeches, {name}!"],
  },
  grease: {
    bully: [
      "{name}, I've bet with the best of it since 1987. Your move.",
      "Coupons clip themselves, {name}. This bet doesn't. I have it.",
    ],
    win: ["Value. Beautiful discounted value.", "That's how you stretch a dollar, folks."],
    lose: ["There goes the grocery budget."],
    bigCall: ["I counted every chip in this call. Twice."],
    bigFold: ["Too rich for my blood. And my blood is THRIFTY."],
    comeback: ["{name} wastes words like they're free chips.", "Loud players tip poorly, {name}."],
  },
  pony: {
    bully: [
      "ON YOUR BIKE, {name}!!! PEDAL AWAY FROM THIS POT!",
      "{name}!! CALL if you have the HEART! I don't think you do!",
      "This is POKER {name}, not a tea party! FOLD or FIGHT!",
      "I'm going to eat your stack ALIVE, {name}. Starting now.",
    ],
    win: ["THAT'S THE GREATEST HAND EVER PLAYED! By me. Obviously.", "GET ON YOUR BIKE! GO HOME!"],
    lose: ["You got lucky, VERY lucky, and everyone here knows it!"],
    bigCall: ["I call with my HEART, something {name} knows nothing about!"],
    bigFold: ["I fold out of RESPECT. Enjoy it. It won't happen again."],
    comeback: ["{name}, keep talking, I LOVE taking chips from talkers!", "Somebody get {name} a bicycle!"],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(line: string, targetName?: string | null) {
  return line.replaceAll("{name}", String(targetName || "friend")).slice(0, 178);
}

// A context line for a character, or null if it has none for that context.
export function pickBanterLine({
  characterId,
  context,
  targetName,
}: {
  characterId: string;
  context: BanterContext;
  targetName?: string | null;
}): string | null {
  const bank = BANKS[characterId];
  const lines = bank?.[context];
  if (!lines || !lines.length) return null;
  return fill(pick(lines), targetName);
}

// A comeback from `characterId` about another speaker (bot OR human) by name.
export function pickComebackLine({
  characterId,
  aboutName,
}: {
  characterId: string;
  aboutName: string;
}): string | null {
  const bank = BANKS[characterId];
  if (!bank?.comeback || !bank.comeback.length) return null;
  return fill(pick(bank.comeback), aboutName);
}

export function hasBanter(characterId?: string | null): boolean {
  return !!(characterId && BANKS[characterId]);
}
