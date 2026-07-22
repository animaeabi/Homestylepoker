// Character table-chat banter (server side).
//
// Short, in-character chat lines the runtime posts AS the bots into the real
// table chat: bullying a live opponent by name after a big raise, gloating or
// grumbling at settle, and quick bot-to-bot comebacks so the table argues with
// itself. `{name}` is replaced with the target player's name.
//
// These lines are built from researched SPEECH STRUCTURE, not catchphrase
// bingo -- each character has a documented "speech DNA" and every line follows
// it. All parody flavor; never quotes. Keep lines under the chat's 180 cap.
//
// SPEECH DNA (from public-persona research):
// - negranope: friendly mind-reader. Range monologue -> elimination -> precise
//   guess AS A QUESTION; self-disclosure levers ("I can only beat a bluff");
//   warm off-topic pivots; gleeful "show me, am I right?"; chirps, never insults.
// - donk: flat-affect action monster. Mumbled hedges ("i guess", "probably",
//   "sorry") wrapping enormous action; monotone indifference win or lose;
//   the comedy is the gap between the words and the bet.
// - holes: mindset-coach crusher. Life-coach cadence (reflect -> journey ->
//   gratitude); reframes everything as growth; casually monstrous wealth
//   delivered humbly; will offer you an app.
// - haxxon: GTO philosopher. Precise probability + dry understatement; caveat
//   stacks ("probably", "in expectation", "conditional on"); everyday life
//   analyzed as game theory; calm principled objections.
// - eyev: weaponized silence. One-word actions; four-word answers; devastating
//   reads delivered as bored observations; lets the silence do the bullying.
// - hellsmouth: the brat. Eruption -> sulky muttering -> second eruption;
//   repeats a word when agitated; talks ABOUT you in third person to an
//   invisible audience ("is anyone SEEING this?"); percentages as evidence in
//   his trial against the universe; category insults ("internet kids");
//   martyrdom always.
// - sydell: quiet legend. Achievements framed as modest luck; gentle wisdom
//   with a self-deprecating hedge; mild era comparisons; "Nice hand." grace.
// - hunger: brash genius, action junkie. Rapid clipped patter; open critique
//   of YOUR play to your face; hypothetical concession instantly revoked
//   ("maybe someday someone beats me... nah"); wants you broken, not just
//   beaten; escalates stakes as a dare; contempt for slowness.
// - grease: the nit. Passive-aggressive PROCEDURAL grievance -- attacks the
//   rake/structure/tempo, never the player; exact accounting recited from
//   memory; waited-hours laments; offended when his one raise gets no action.
// - pony: the steamroller. Machine-gun imperatives DURING your decision;
//   repetition ladders rising in volume; courage/heart framing; career
//   obituaries + transport-based evictions; territorial "MY game"; announces
//   plays then shamelessly admits lying.

export type BanterContext = "bully" | "win" | "lose" | "bigCall" | "bigFold";

type LineBank = Partial<Record<BanterContext, string[]>> & {
  comeback?: string[]; // reply about another character; {name} = who spoke
};

const BANKS: Record<string, LineBank> = {
  negranope: {
    bully: [
      "Ok {name}, that sizing... it's ace-queen or nines. Not both. I'm gonna say nines. Am I right?",
      "{name}, I'll make it easy: you have exactly king-jack and you already hate it. Show me after?",
      "So it's either the flush draw or total air, {name}... actually, you know what? It's the draw. Fold and save us both.",
      "Where'd you say you were from, {name}? Nice. Anyway -- you've got the queens, right? Right?",
      "{name} buddy, tough spot. I know it's tough because I know what you have. Both cards.",
    ],
    win: [
      "Called it out loud BEFORE the river. That's the part I enjoy.",
      "What can I say -- people talk to me, chips follow.",
      "I honestly feel bad. Not bad enough to give it back, but bad.",
    ],
    lose: [
      "Wowwww. Of course. OF COURSE. Nice hand though, seriously.",
      "I named your exact two cards and paid you anyway. That's an art form.",
    ],
    bigCall: ["I can only beat a bluff here... lucky for me, I'm sure that's what this is."],
    bigFold: ["That's ace-king and it's good. Don't show me. Actually -- show me?"],
    comeback: [
      "{name}, I love the energy, but your bet sizes are telling me your whole life story.",
      "See, {name} talks loud. The chips talk quiet. Guess who I listen to.",
    ],
  },
  donk: {
    bully: [
      "i guess... all-in. sorry {name}",
      "{name} you probably have it. probably. [raises anyway]",
      "this is either really good or really bad. we'll find out {name}",
      "yeah i dunno. donk bomb. your problem now {name}",
    ],
    win: [
      "hm. that's... fine i guess",
      "oh. it worked. weird",
      "seven high is basically a pair if you bet enough",
    ],
    lose: [
      "yeah that's probably fair",
      "eh. variance is just weather",
      "ok. rebuy i guess",
      "that happens. probably my fault. whatever",
    ],
    bigCall: ["that's probably a bad call. calling"],
    bigFold: ["fine. keeping two chips for later"],
    comeback: [
      "{name} said a lot of words just now. anyway. raise",
      "loud table. i might nap between hands",
    ],
  },
  holes: {
    bully: [
      "{name}, before you call, maybe check in with your energy first. Mine says this pot is already on my journey.",
      "I want to be transparent with you, {name}: this bet comes from a place of abundance. Yours would come from fear.",
      "{name}, folding here could be a real growth moment for you. I'm rooting for you either way.",
      "This is lunch money for me, {name}, but the LESSON? The lesson is priceless.",
    ],
    win: [
      "Grateful for this pot, grateful for this table, grateful for your call honestly.",
      "Money stopped motivating me a few eight-figure years ago. And yet.",
      "Another small win on the inner journey. And the outer one. Mostly the outer one.",
    ],
    lose: [
      "I lost the pot but I stayed present, and honestly? That's the real win.",
      "Beautiful hand. I'll journal about it tonight.",
    ],
    bigCall: ["My mindset coach said stop hero-calling. I fired him. Call."],
    bigFold: ["Releasing this hand. Releasing the attachment. Keeping the yacht."],
    comeback: [
      "{name}, that anger is just fear wearing a costume. I have an app for this.",
      "Sending {name} positive energy. And taking his chips. Balance.",
    ],
  },
  haxxon: {
    bully: [
      "{name}, this works about 43 percent of the time. Which, unfortunately for you, is enough.",
      "In equilibrium I mix here, {name}. Against you specifically? I'm not mixing.",
      "{name}, your range is roughly 12 percent value, conditional on your last three showdowns. Just noting it.",
      "The solver says you fold here, {name}. The solver has never been wrong about you before.",
    ],
    win: [
      "EV realized. Nothing personal -- expectation rarely is.",
      "Within one standard deviation of exactly what I said would happen.",
    ],
    lose: [
      "Fine in expectation. Annoying in practice.",
      "I'm not upset. I simply think what just happened was mathematically indefensible, and I've prepared remarks.",
    ],
    bigCall: ["Pot odds say call. I am merely the vessel."],
    bigFold: ["Negative EV. Discarded without ceremony."],
    comeback: [
      "{name}, that outburst was -EV and, worse, off-equilibrium.",
      "Interesting. {name} tilts at a higher frequency than the solver recommends.",
    ],
  },
  eyev: {
    bully: [
      "{name}. You looked at your chips before the flop came.",
      "Raise. Take your time, {name}. I have all of it.",
      "{name}. You already know.",
    ],
    win: ["Yeah.", "As expected.", "Mm.", "That's the one."],
    lose: ["Noted.", "Okay.", "Fair."],
    bigCall: ["Show me."],
    bigFold: ["No."],
    comeback: ["{name} talks. I collect.", "...", "{name}. Play the hand."],
  },
  hellsmouth: {
    bully: [
      "Is anyone SEEING this? Is {name} actually thinking of calling me? Unbelievable. UNBELIEVABLE.",
      "Honey! {name} is about to make the worst call in the history of this table. I can't watch.",
      "Seventeen bracelets of experience says fold, {name}. But these internet kids never listen. NEVER.",
      "It's fine. It's fine. {name} will call with garbage, hit his miracle, and I'LL be the crazy one.",
    ],
    win: [
      "THAT'S why they call me the best. Say it. Somebody at this table say it.",
      "Played it PERFECT. Absolutely perfect. Finally the universe pays its debts.",
      "I can dodge bullets, baby. Write it down.",
    ],
    lose: [
      "84 percent. EIGHTY-FOUR. And he just... calls. Is this a joke? Am I on a hidden camera show?",
      "It's fine. it's fine. It's not fine. If it weren't for luck I'd win EVERY one of these.",
      "Only me. This stuff only happens to ME. Sixty years of poker and it only happens to me.",
    ],
    bigCall: ["FINE. I call. Somebody has to police this table and it's ALWAYS me."],
    bigFold: ["That's a world-class fold right there. Nobody else on EARTH makes that fold. Nobody."],
    comeback: [
      "Oh {name} is talking now? Honey, come look -- {name} thinks he's a poker player!",
      "Nineteen titles, {name}. NINETEEN. When you get one, you can speak.",
    ],
  },
  sydell: {
    bully: [
      "{name}, I've seen this exact spot for forty years. It usually ends quietly.",
      "No rush, {name}. Although the fold does tend to age well.",
    ],
    win: [
      "The cards cooperated. They do that occasionally.",
      "I've had some okay results with that line.",
    ],
    lose: ["Nice hand.", "Well played. Probably.", "That's poker. Onward.", "You earned that one."],
    bigCall: ["The kids study charts. I studied you."],
    bigFold: ["I still get plenty wrong. Not this one, though."],
    comeback: ["{name}, stillness would serve you.", "We used to talk like {name} in 1988. We grew out of it."],
  },
  hunger: {
    bully: [
      "{name} you took two minutes to make the wrong play. I'll save you the time: fold.",
      "Double it. Triple it. Whatever number makes your hands shake, {name} -- THAT'S the number.",
      "I don't want your chips, {name}. I want you in the parking lot explaining what went wrong.",
      "Clock's ticking {name}! Good players don't need this long to fold!",
    ],
    win: [
      "Maybe someday somebody plays this game better than me. ...Nah. Forget I said that.",
      "That wasn't a pot, that was a demonstration.",
    ],
    lose: [
      "Congratulations, you caught the only card that saves you. Do it twice and I'll be impressed.",
      "Rack it back. We go again. RIGHT now.",
    ],
    bigCall: ["Instant call. Thinking is for people who aren't sure."],
    bigFold: ["One fold. ONE. Frame it, it won't happen again."],
    comeback: ["{name} talks slow AND plays slow. Deal faster, someone.", "More action, fewer speeches, {name}!"],
  },
  grease: {
    bully: [
      "{name}, I've made this bet four times since 1987. I got paid four times. Just so you have the data.",
      "Take your time {name}. I'm noting the rake went up again while we wait. Wrote it down.",
      "I don't bet without it, {name}. Never have. Check my ledger -- it's laminated.",
    ],
    win: [
      "Value. Clean, documented value. That's going in the ledger with a star next to it.",
      "Two hours for that hand. Minus rake, minus tip... I'll count it later. Twice.",
    ],
    lose: [
      "There goes the buffet voucher.",
      "I'm not saying the deck is rigged. I'm saying I wrote down the time and the dealer's name.",
    ],
    bigCall: ["I counted every chip in this call twice. The math is... acceptable."],
    bigFold: ["Too rich. And before anyone asks -- yes, I'm noting the blinds went up mid-hand. Again."],
    comeback: [
      "{name} has been loud for three hands and up exactly zero chips. I keep records.",
      "All that shouting and {name} still tips one chip. Takes one to know one, actually.",
    ],
  },
  pony: {
    bully: [
      "Look at this. LOOK at this, {name}! You don't have the heart to call and everybody here knows it!",
      "ON YOUR BIKE, {name}! Pedal home! This is MY game and the pot already knows it!",
      "Call it, {name}! Call it if you're a man! I already know how this ends -- I'm just being polite!",
      "It's over for you {name}. Finished. Done in this game. The bus leaves in five, be on it!",
      "You come to MY table, {name}, with THAT? Time to go. TIME. TO. GO.",
    ],
    win: [
      "AND THAT'S IT! Somebody bring the bike around front, we've got a rider!",
      "Did everyone SEE that?! That's heart! That's how you play this game!",
      "Of course I said I had it. Of course I lied. THIS IS POKER!",
    ],
    lose: [
      "Lucky! LUCKY! You'll give it all back within the hour and I'll be here collecting!",
      "Enjoy it loudly, because it's the last pot you drag tonight!",
    ],
    bigCall: ["I call with my HEART -- something half this table was born without!"],
    bigFold: ["I fold out of RESPECT. Enjoy the moment. It expires immediately."],
    comeback: [
      "Keep talking {name}, I LOVE taking money from commentators!",
      "Somebody get {name} a bicycle. A small one!",
    ],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(line: string, targetName?: string | null) {
  return line.replaceAll("{name}", String(targetName || "friend")).slice(0, 178);
}

// Pick a filled line the caller hasn't seen recently. `avoid` holds the exact
// text of lines already on screen for this speaker; we re-roll a few times to
// dodge them so a bot never posts the same words twice in a row. If the bank is
// so small that every option is in `avoid`, return null so the caller stays
// silent rather than repeat itself.
function pickFresh(lines: string[], targetName: string | null | undefined, avoid?: string[] | null): string | null {
  if (!lines.length) return null;
  const blocked = new Set((avoid || []).map((s) => String(s || "").trim()));
  let last: string | null = null;
  for (let i = 0; i < 8; i += 1) {
    const candidate = fill(pick(lines), targetName);
    last = candidate;
    if (!blocked.has(candidate.trim())) return candidate;
  }
  // Every roll landed on a recently-used line. If the bank has an unused line we
  // just got unlucky finding it; scan directly before giving up.
  const fresh = lines.map((l) => fill(l, targetName)).find((l) => !blocked.has(l.trim()));
  return fresh ?? (blocked.size ? null : last);
}

// A context line for a character, or null if it has none for that context.
export function pickBanterLine({
  characterId,
  context,
  targetName,
  avoid,
}: {
  characterId: string;
  context: BanterContext;
  targetName?: string | null;
  avoid?: string[] | null;
}): string | null {
  const bank = BANKS[characterId];
  const lines = bank?.[context];
  if (!lines || !lines.length) return null;
  return pickFresh(lines, targetName, avoid);
}

// A comeback from `characterId` about another speaker (bot OR human) by name.
export function pickComebackLine({
  characterId,
  aboutName,
  avoid,
}: {
  characterId: string;
  aboutName: string;
  avoid?: string[] | null;
}): string | null {
  const bank = BANKS[characterId];
  if (!bank?.comeback || !bank.comeback.length) return null;
  return pickFresh(bank.comeback, aboutName, avoid);
}

export function hasBanter(characterId?: string | null): boolean {
  return !!(characterId && BANKS[characterId]);
}
