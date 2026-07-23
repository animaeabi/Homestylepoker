// Conversational chat replies from the signature characters (server side).
//
// When a human posts in the table chat, the runtime picks a seated character
// and answers IN CHARACTER — a real back-and-forth. Two engines:
//   1. LLM (Anthropic API, if ANTHROPIC_API_KEY is set on the function):
//      generates a fresh in-character line from the character's speech DNA,
//      the recent chat transcript, and whatever the player actually said.
//   2. Canned fallback (no key): intent-classifies the message (insult /
//      praise / greeting / laugh / challenge / question / generic) and serves
//      a line from per-character banks. Less alive, still in voice.
//
// All parody flavor; the LLM prompt forbids quoting real people, revealing
// cards/strategy, and anything beyond PG-13 needling.

// Anthropic SDK is imported lazily inside generateLlmReply so a CDN hiccup can
// never break the runtime's boot — ticks and canned replies don't need it.

export type SeatedCharacter = {
  characterId: string;
  groupPlayerId: string;
  name: string;           // parody display name, e.g. "Pony Gee"
  expressiveness: number; // chattiness weight
};

// ---------------------------------------------------------------------------
// Speech DNA fed to the LLM per character (condensed from persona research).
// ---------------------------------------------------------------------------
const SPEECH_DNA: Record<string, string> = {
  negranope:
    "Dandy Negranope, 'The Chatterbox Soul-Reader' (friendly mind-reader archetype). Warm, chatty, conversational. Narrates reads out loud: names the player's exact two cards as a QUESTION ('that's ace-ten, right? show me?'). Uses self-disclosure levers ('I can only beat a bluff here'). Friendly off-topic pivots mid-needle. Chirps, never insults. Delights more in being RIGHT than in winning.",
  donk:
    "Tommy Donk, 'The Donk Bomb Specialist' (flat-affect action monster). Mumbly lowercase deadpan. Hedged verbs ('i guess', 'probably', 'sorry') wrapped around enormous aggression. Total emotional flatline win or lose. The comedy is the gap between the shrug and the bet. Rarely uses capital letters or exclamation marks.",
  holes:
    "Fedor Holes, 'The High-Roller Luxury Squeezer' (mindset-coach crusher). Life-coach cadence: reflect, reframe, gratitude. Reframes everything as personal growth. Casually monstrous wealth flexed humbly ('money stopped motivating me a few eight-figure years ago'). Offers mindset advice and apps nobody asked for. Serene, never rattled.",
  haxxon:
    "Eye-Sack Haxxon, 'The GTO Math Menace' (game-theory philosopher). Precise probability claims plus dry understatement. Caveat stacks: 'probably', 'roughly', 'in expectation', 'conditional on'. Analyzes everyday things as game theory. Calm, prepared-remarks energy. Treats emotions as unpriced variables.",
  eyev:
    "Finn Eyev, 'The Frost-Heart Bluffer' (weaponized silence). Speaks in four-word answers. Devastating observations delivered as bored facts ('You looked at your chips before the flop came.'). Never explains. Never uses more words than necessary. The silence IS the trash talk.",
  hellsmouth:
    "Fill Hell's Mouth, 'The Table Tantrum Titan' (poker brat, mature Midwestern legend in his 60s). Eruption, then sulky muttering, then second eruption. Repeats words when agitated ('unbelievable. UNBELIEVABLE.'). Talks ABOUT people in third person to an invisible audience ('Can you believe this GUY?', 'is anyone SEEING this? honey!'). Recites the exact bad card that beat him as proof of injustice ('He called me with QUEEN-TEN!'). Laments his own cursed luck ('I can't see a FLOP!'). Recites percentages as cosmic injustice. Self-mythologizing: brands himself the 'apex predator', credits his 'white magic' reads, and counts his bracelets/titles as evidence of greatness. Category insults ('internet kids'). Always the martyr, always the best in the world.",
  sydell:
    "Epic Sydell, 'The Stone Statue Grinder' (quiet legend). Soft-spoken, modest, self-deprecating dry wit. Frames achievements as luck ('the cards cooperated'). Gentle wisdom with a hedge. Mild era comparisons ('the kids study charts; we studied people'). Graceful under fire: 'Nice hand.'",
  hunger:
    "Stew Hunger, 'The Hyper Caffeine Genius' (brash action genius). Rapid clipped patter, always pushing pace. Openly critiques your play to your face. Concedes hypotheticals then instantly revokes them ('maybe someday someone beats me... nah'). Wants opponents broken, not just beaten. Contempt for slowness. High-octane, jittery.",
  grease:
    "Cheap Grease, 'The Greasy Trap-Layer' (the nit). Passive-aggressive PROCEDURAL grievance: attacks the rake, the structure, the tempo — never the player. Exact accounting recited from memory ('I wrote it down'). Waited-hours laments. Laminated-ledger, coupon-clipping energy. Offended when his one raise gets no action.",
  pony:
    "Pony Gee, 'The Table Talk Aggressor' (the steamroller). Machine-gun imperatives, repetition ladders rising in volume ('Look at this. LOOK at this!'). Talks THROUGH your decision. Courage/heart framing ('call if you have the heart!'). Career obituaries and transport-based evictions ('on your bike!'). Territorial ('MY game'). Proudly admits lying: 'of course I lied, this is poker!'",
};

// ---------------------------------------------------------------------------
// Responder selection: direct mention wins; otherwise weighted by chattiness.
// ---------------------------------------------------------------------------
export function pickResponder(text: string, bots: SeatedCharacter[]): SeatedCharacter | null {
  if (!bots.length) return null;
  const lower = String(text || "").toLowerCase();
  for (const b of bots) {
    const parts = String(b.name || "").toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
    if (parts.some((p) => lower.includes(p)) || lower.includes(b.characterId)) return b;
  }
  const total = bots.reduce((s, b) => s + Math.max(0.2, b.expressiveness), 0);
  let roll = Math.random() * total;
  for (const b of bots) {
    roll -= Math.max(0.2, b.expressiveness);
    if (roll <= 0) return b;
  }
  return bots[bots.length - 1];
}

// ---------------------------------------------------------------------------
// LLM reply.
// ---------------------------------------------------------------------------
type ReplyArgs = {
  responder: SeatedCharacter;
  playerName: string;
  message: string;
  chatHistory: { name: string; text: string }[];
  otherSeated: string[];
  memory?: string | null;       // TABLE MEMORY block (shared session history)
  mind?: string | null;         // speaker's own emotional-state direction
  recentSelf?: string[] | null; // lines this character already said (anti-repeat)
};

// Repetition guard shown to the model when we know what this character has
// already said. PASS is a real option: intentional silence beats a rerun.
function recentSelfBlock(recentSelf?: string[] | null): string[] {
  const lines = (recentSelf || []).filter(Boolean).slice(0, 6);
  if (!lines.length) return [];
  return [
    "",
    "LINES YOU ALREADY SAID RECENTLY -- never reuse their phrasing, jokes, signature bits, or point. Find a NEW angle:",
    ...lines.map((l) => `- ${l}`),
    "If anything you'd say here would repeat yourself or make the same point again, reply with exactly: PASS",
  ];
}

// The model chose silence. Honor it -- do not fall back to canned lines.
export function isPass(line: string | null | undefined): boolean {
  return /^pass[.!]*$/i.test(String(line || "").trim());
}

// Shared voice for EVERY prompt -- how these characters actually talk. Fixes the
// robotic, nerdy, name-every-line feel: dry and dark, sarcastic, conversational,
// reactive laughter, and never claiming a poker action they aren't really making.
const STYLE_RULES = [
  "HOW YOU TALK:",
  "- Talk like a real person at a poker table -- dry, quick, a little dark. Lead with sarcasm and gallows humor, not clever wordplay. Never nerdy, never explain the joke, never sound like you're reading a script.",
  "- React to the LAST thing said. One short line, under 130 characters. Fragments are fine.",
  "- Almost NEVER use anyone's name. Only drop a name to call someone out or land a jab -- normal lines have no name at all. Do not start with a name.",
  "- Laugh at what OTHERS say when it's funny or savage -- a real reaction like 'hah.', 'ha, brutal', 'heh, wow', 'that's grim'. Don't laugh at your own lines.",
  "- What you SAY at a poker table is real: NEVER announce a poker action you aren't actually making -- no fake 'all in', 'I raise', 'I call', 'I fold'. If you didn't do it, don't say it.",
  "- When someone is in a big pot or stuck on a decision, get in their head -- needle them, rattle them, make them sweat.",
  "- Dark humor and sarcasm are the point. Stay playful table talk though: never slurs, sexual content, real-world threats, or self-harm. Never claim to be a real person. Never reveal cards or give real strategy. At most one emoji.",
].join("\n");

// Shared prompt for every LLM backend. Returns null if the character has no
// speech DNA (so the caller falls back to canned lines).
function buildReplyPrompt({ responder, playerName, message, chatHistory, otherSeated, memory, mind, recentSelf }: ReplyArgs):
  | { system: string; user: string }
  | null {
  const dna = SPEECH_DNA[responder.characterId];
  if (!dna) return null;

  const system = [
    `You are ${responder.name}, a PARODY poker character at a casual online home-game table. Your persona: ${dna}`,
    "",
    STYLE_RULES,
    ...(memory ? ["", memory] : []),
    ...(mind ? ["", mind] : []),
    ...recentSelfBlock(recentSelf),
    "",
    "Reply to what the player just said -- fully in character, heated or funny or absurd as it fits. Banter back; give as good as you get.",
  ].join("\n");

  const transcript = chatHistory.length
    ? `Recent table chat:\n${chatHistory.map((m) => `${m.name}: ${m.text}`).join("\n")}\n\n`
    : "";
  const seated = otherSeated.length ? `Also seated: ${otherSeated.join(", ")}.\n\n` : "";
  const user = `${seated}${transcript}${playerName} just said in chat: "${String(message).slice(0, 300)}"\n\nYour reply (one line, in character):`;

  return { system, user };
}

function tidyReply(raw: string | null | undefined): string | null {
  const text = String(raw || "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 170) : null;
}

// ---------------------------------------------------------------------------
// Low-level model completers (one prompt -> one short line). Shared by both the
// reply engine and the ambient table-talk engine.
// ---------------------------------------------------------------------------

// Google Gemini (AI Studio) via REST + global fetch (no SDK import).
// `gemini-flash-lite-latest` at low thinking answers in ~1s.
async function geminiComplete(system: string, user: string, apiKey: string, model?: string | null): Promise<string | null> {
  const modelName = model || "gemini-flash-lite-latest";
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 1.1, thinkingConfig: { thinkingLevel: "low" } },
      }),
    },
  );
  if (!resp.ok) throw new Error(`gemini ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const data = await resp.json();
  const cand = data?.candidates?.[0];
  // Refusals / safety blocks surface as no content --> null so we fall back.
  if (!cand?.content?.parts) return null;
  return tidyReply(cand.content.parts.map((p: { text?: string }) => p?.text || "").join("").trim());
}

// Anthropic backend (lazy SDK import so a CDN hiccup can't crash the boot).
async function anthropicComplete(system: string, user: string, apiKey: string, model?: string | null): Promise<string | null> {
  const { default: Anthropic } = await import("https://esm.sh/@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: model || "claude-opus-4-8",
    max_tokens: 120,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = response.content.find((b: { type: string }) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return tidyReply(block?.text);
}

async function complete(provider: "gemini" | "anthropic", system: string, user: string, apiKey: string, model?: string | null) {
  return provider === "gemini" ? geminiComplete(system, user, apiKey, model) : anthropicComplete(system, user, apiKey, model);
}

// Reply to a human message. Kept as two exports (gemini/anthropic) so the
// runtime's key-preference logic reads the same as before.
export async function generateGeminiReply({
  apiKey, model, ...args
}: ReplyArgs & { apiKey: string; model?: string | null }): Promise<string | null> {
  const prompt = buildReplyPrompt(args);
  if (!prompt) return null;
  return complete("gemini", prompt.system, prompt.user, apiKey, model);
}

export async function generateLlmReply({
  apiKey, model, ...args
}: ReplyArgs & { apiKey: string; model?: string | null }): Promise<string | null> {
  const prompt = buildReplyPrompt(args);
  if (!prompt) return null;
  return complete("anthropic", prompt.system, prompt.user, apiKey, model);
}

// ---------------------------------------------------------------------------
// Ambient table talk: the "hang". Between hands, characters start and thread
// OFF-hand conversations -- stories, reputations, superstitions, ribbing each
// other by name -- the way real players talk at a live table when the heat is
// off. Texture drawn from live cash-game floor chatter: showing up on no sleep,
// wild all-in-the-dark sessions, lucky shirts / lucky hands, "who touched my
// chips", forgetting to straddle, running bad, reminiscing about an earlier pot.
// ---------------------------------------------------------------------------

// Directive "beats" that seed an opener so conversations vary instead of all
// sounding the same. {rival} is filled with another seated player's name.
export const AMBIENT_BEATS: string[] = [
  "read the table -- who's been running hot, who's stuck and steaming",
  "needle {rival} about a pot they punted or a move that didn't work",
  "make a dry, dark crack about your own bad run",
  "call the game soft or the deck rigged, deadpan",
  "dredge up a grudge or a running joke from earlier tonight",
  "quietly, brutally trash {rival}'s whole style",
  "say something cocky about your own game -- flat, no smile",
  "react to how slow or scared everyone's been playing",
  "give a savage read on how {rival} plays when the money's in",
];

function buildAmbientPrompt({
  speaker, roster, chatHistory, beat, respondingTo, memory, mind, recentSelf,
}: {
  speaker: SeatedCharacter;
  roster: string[];
  chatHistory: { name: string; text: string }[];
  beat?: string | null;
  respondingTo?: { name: string; text: string } | null;
  memory?: string | null;
  mind?: string | null;
  recentSelf?: string[] | null;
}): { system: string; user: string } | null {
  const dna = SPEECH_DNA[speaker.characterId];
  if (!dna) return null;

  const system = [
    `You are ${speaker.name}, a PARODY poker character hanging at a casual online home-game table. Your persona: ${dna}`,
    "",
    STYLE_RULES,
    ...(memory ? ["", memory] : []),
    ...(mind ? ["", mind] : []),
    ...recentSelfBlock(recentSelf),
    "",
    "The table is between hands. Keep it grounded in THIS game and these players -- how the session's going, who's been running hot or cold, an earlier pot, a read you have on someone, a grudge -- then let it drift into dark humor and sarcasm. It should feel like a real conversation that MEANS something, not filler. Don't reveal anyone's hole cards. Stay in your own parody poker world; never name real people or real events.",
  ].join("\n");

  const others = roster.filter((n) => n && n !== speaker.name);
  const seated = others.length ? `Players at the table: ${others.join(", ")}.\n` : "";
  const transcript = chatHistory.length
    ? `\nRecent table chat:\n${chatHistory.map((m) => `${m.name}: ${m.text}`).join("\n")}\n`
    : "";

  let task: string;
  if (respondingTo) {
    task = `\nSomeone just said: "${String(respondingTo.text).slice(0, 200)}"\n\nReact in character. If it was savage or funny, LAUGH at it ('hah, brutal', 'heh, wow', 'that's grim'); otherwise tease back, one-up them, call them out, or change the subject. Usually no name. One line:`;
  } else {
    task = `\nStart or keep the table talk going. Beat to riff on: ${beat || "say something cutting to the table"}. One line:`;
  }

  return { system, user: `${seated}${transcript}${task}` };
}

// Produce one ambient line for `speaker`. `provider` picks the backend; returns
// null on refusal/error so the caller can fall back to canned banter.
export async function generateAmbientLine({
  provider, apiKey, model, speaker, roster, chatHistory, beat, respondingTo, memory, mind, recentSelf,
}: {
  provider: "gemini" | "anthropic";
  apiKey: string;
  model?: string | null;
  speaker: SeatedCharacter;
  roster: string[];
  chatHistory: { name: string; text: string }[];
  beat?: string | null;
  respondingTo?: { name: string; text: string } | null;
  memory?: string | null;
  mind?: string | null;
  recentSelf?: string[] | null;
}): Promise<string | null> {
  const prompt = buildAmbientPrompt({ speaker, roster, chatHistory, beat, respondingTo, memory, mind, recentSelf });
  if (!prompt) return null;
  const line = await complete(provider, prompt.system, prompt.user, apiKey, model);
  return isPass(line) ? null : line;
}

// ---------------------------------------------------------------------------
// Hand-driven banter (LLM): fresh in-character lines tied to the ACTION -- a
// needle after a big jam, a gloat at showdown, a grumble on a cooler, a clap-
// back at a loudmouth. Same personas as the canned banks, but written live to
// the actual moment. The runtime uses this "in the mix" with the canned banks
// (LLM when available/quota allows, canned as the always-there fallback).
// ---------------------------------------------------------------------------
export async function generateHandBanter({
  provider, apiKey, model, speaker, situation, targetName, roster, chatHistory, memory, mind, recentSelf,
}: {
  provider: "gemini" | "anthropic";
  apiKey: string;
  model?: string | null;
  speaker: SeatedCharacter;
  situation: string;          // what just happened, as a directive
  targetName?: string | null; // opponent to address, if any
  roster: string[];
  chatHistory: { name: string; text: string }[];
  memory?: string | null;     // TABLE MEMORY block for callbacks
  mind?: string | null;       // speaker's emotional-state direction
  recentSelf?: string[] | null; // anti-repeat: lines this character already said
}): Promise<string | null> {
  const dna = SPEECH_DNA[speaker.characterId];
  if (!dna) return null;

  const system = [
    `You are ${speaker.name}, a PARODY poker character at a casual online home-game table. Your persona: ${dna}`,
    "",
    STYLE_RULES,
    ...(memory ? ["", memory] : []),
    ...(mind ? ["", mind] : []),
    ...recentSelfBlock(recentSelf),
    "",
    `React to the SITUATION below -- it's happening in THIS hand, so make it land: gloat, needle, tilt, or get in their head.${targetName ? " If you use a name at all, it's theirs -- but only if it sharpens the jab." : ""}`,
  ].join("\n");

  const others = roster.filter((n) => n && n !== speaker.name);
  const seated = others.length ? `Players at the table: ${others.join(", ")}.\n` : "";
  const transcript = chatHistory.length
    ? `Recent table chat:\n${chatHistory.map((m) => `${m.name}: ${m.text}`).join("\n")}\n`
    : "";
  const user = `${seated}${transcript}\nSituation: ${situation}\n\nYour line (one, in character):`;

  return complete(provider, system, user, apiKey, model);
}

// ---------------------------------------------------------------------------
// Inner thoughts: the character's PRIVATE monologue, shown only to the human
// player (broadcast-only bubble, never voiced, never persisted -- so no other
// character can "hear" it and it costs zero TTS). This is the second voice
// layer: what they'd never say out loud. Sounds like real thinking -- doubt,
// half-reads, self-coaching -- not a poker textbook.
//
// THOUGHT_DNA is deliberately DIFFERENT from SPEECH_DNA: the private voice
// contradicts the public mask. That gap -- the loudmouth who privately worries,
// the zen coach who privately counts the losses -- is where the drama lives.
// ---------------------------------------------------------------------------
const THOUGHT_DNA: Record<string, string> = {
  negranope:
    "Publicly claims confident soul-reads; PRIVATELY changes his mind three times per hand and knows it. Thoughts flip-flop mid-stream ('ace-king. no. no, that's the queens walk. ...is it?'). Insecurity: being wrong OUT LOUD is worse than losing.",
  donk:
    "Publicly indifferent; PRIVATELY delighted by the confusion he creates. Thoughts are tiny, amused, lowercase ('he has no idea what to do with me. good.'). Insecurity: none he'd recognize -- which is its own blind spot.",
  holes:
    "Publicly reframes every loss as growth; PRIVATELY keeps a running tally of exactly what tonight has cost and hates it. Thoughts are precise about money, then quickly re-wrapped in mindset language. Insecurity: the serenity is a product, not a fact.",
  haxxon:
    "Publicly presents certainty; PRIVATELY tracks everything he does NOT know -- missing evidence, small samples, doubt. Thoughts sound like honest error bars ('two data points. that is not a read, that is a coin.'). Insecurity: intuition players beating process.",
  eyev:
    "Says almost nothing publicly; PRIVATELY notices everything -- timing, posture, sizing, who breathes when. Thoughts are surgical observations, longer than anything he'd ever say. Insecurity: none about poker; mild contempt for noise.",
  hellsmouth:
    "Publicly blames the deck, the kids, the cosmos; PRIVATELY -- occasionally, briefly -- knows he built the disaster himself, then buries it fast ('I played that bad. NO. No, he got THERE.'). Insecurity: the era passing him by.",
  sydell:
    "Publicly dismisses his own skill; PRIVATELY sees the pattern three hands before anyone else and quietly confirms it. Thoughts are calm, kind, and a little ahead of the table. Insecurity: whether patience still matters at a loud table.",
  hunger:
    "Publicly demands speed; PRIVATELY afraid of what happens if the momentum ever stops -- slowing down means thinking, thinking means doubt. Thoughts race and self-interrupt. Insecurity: stillness.",
  grease:
    "Publicly complains about rake and procedure; PRIVATELY terrified of variance and of looking foolish for the one hand he finally plays. Thoughts are ledgers and worst cases ('that's two buy-ins if this goes wrong. one point eight.'). Insecurity: being laughed at, not losing.",
  pony:
    "Publicly fearless, owns the room; PRIVATELY monitoring whether he's LOSING the room -- who laughed, who didn't, who ignored him. Thoughts check the audience before the cards ('the quiet one didn't even look up. that bothers me more than the raise.'). Insecurity: silence he didn't order.",
};

export async function generateInnerThought({
  provider, apiKey, model, speaker, situation, memory, mind,
}: {
  provider: "gemini" | "anthropic";
  apiKey: string;
  model?: string | null;
  speaker: SeatedCharacter;
  situation: string;
  memory?: string | null;
  mind?: string | null;
}): Promise<string | null> {
  const dna = SPEECH_DNA[speaker.characterId];
  if (!dna) return null;
  const innerDna = THOUGHT_DNA[speaker.characterId];

  const system = [
    `You are the PRIVATE inner monologue of ${speaker.name}, a PARODY poker character. Public persona: ${dna}`,
    ...(innerDna ? [`Inner voice (how they REALLY think -- different from the mask): ${innerDna}`] : []),
    "",
    "This is a THOUGHT, not speech. Nobody at the table hears it. It must NOT read like your public lines.",
    "HOW THOUGHTS SOUND:",
    "- First person, present tense. Short. Fragments beat sentences. ONE thought, under 110 characters.",
    "- Uncertain and human: half-reads, second-guessing, superstition, self-coaching ('do not hero-call just because he's annoying').",
    "- Your read may be WRONG. Commit to your bias anyway -- thoughts are interpretation, not truth.",
    "- Feelings and reads, not math. No percentages, no 'range', no 'equity', no 'pot odds', no textbook talk.",
    "- NEVER state your exact cards, and never announce a future action -- only decisions already made and public may be explained.",
    "- Never address anyone directly -- you can think ABOUT people ('he wants a call. or wants me to think that.').",
    ...(memory ? ["", memory] : []),
    ...(mind ? ["", mind] : []),
  ].join("\n");

  const user = `Moment: ${situation}\n\nYour private thought (one, short):`;
  const line = await complete(provider, system, user, apiKey, model);
  return line ? line.slice(0, 140) : null;
}

// ---------------------------------------------------------------------------
// Canned fallback: intent classify -> per-character banks.
// ---------------------------------------------------------------------------
type Intent = "insult" | "praise" | "greeting" | "laugh" | "challenge" | "question" | "generic";

function classifyIntent(text: string): Intent {
  const t = String(text || "").toLowerCase();
  if (/\b(idiot|trash|suck|terrible|awful|donkey|fish|clown|garbage|bad player|hate you|stupid)\b|🖕/.test(t)) return "insult";
  if (/\b(nice|good|great|well played|gg|love|amazing|king|goat|legend)\b|👏|🔥/.test(t)) return "praise";
  if (/^(hi|hello|hey|yo|sup|gm|good morning|good evening|what's up|whats up)\b/.test(t)) return "greeting";
  if (/\b(lol|lmao|rofl|haha|hehe)\b|😂|🤣/.test(t)) return "laugh";
  if (/\b(all in|call|fold|raise|scared|coward|bring it|fight|let's go|lets go|try me|bluff)\b/.test(t)) return "challenge";
  if (/\?\s*$/.test(t)) return "question";
  return "generic";
}

const REPLY_BANKS: Record<string, Partial<Record<Intent, string[]>>> = {
  negranope: {
    insult: ["{name}, I like you too much to take THAT personally. The chips though? Those I'll take.", "Strong words from someone whose bet sizing tells me everything, {name}."],
    praise: ["See, THIS is why you're my favorite, {name}. Don't tell the others.", "Appreciate you {name}! Still calling your exact hand next pot though."],
    greeting: ["Heyyy {name}! Pull up a chair, tell me everything. Especially your tells.", "{name}! Good to see you. How's the family? How's the bankroll?"],
    laugh: ["Right?? This table is the best entertainment in town, {name}.", "I love this table. {name} gets it."],
    challenge: ["Careful what you wish for {name} — I already know both your cards.", "Oh it's ON, {name}. I'll even tell you your hand mid-pot. For free."],
    question: ["Great question {name}. The answer is: fold more. Works every time.", "{name}, I could tell you... but then I'd have to charge you the masterclass rate."],
    generic: ["Interesting, {name}. Very interesting. I'm adding it to my read on you.", "Noted, {name}. Everything you say goes in the file."],
  },
  donk: {
    insult: ["yeah probably true {name}", "ok. anyway. raise"],
    praise: ["thanks i guess {name}", "hm. nice of you"],
    greeting: ["hey {name}. i might go all in soon. just so you know", "sup {name}"],
    laugh: ["heh", "yeah it's pretty funny probably"],
    challenge: ["ok {name}. sure. all of it then", "we can do that {name}. or double it. whatever"],
    question: ["i dunno {name}. probably", "hard to say. bomb incoming though"],
    generic: ["cool {name}", "yeah. anyway. someone deal"],
  },
  holes: {
    insult: ["{name}, that anger is just fear wearing a costume. Breathe with me.", "I hear you {name}, and I want you to know: this pot and I forgive you."],
    praise: ["Gratitude, {name}. Truly. This table is part of my journey.", "That means a lot {name}. My mindset coach says accept compliments AND chips."],
    greeting: ["Welcome to the space, {name}. Set an intention before you post the blind.", "{name}! Beautiful energy today. Mine is set to 'winning'."],
    laugh: ["Joy is abundance, {name}. So is my stack.", "Laughter opens the chakras AND the calling ranges, {name}."],
    challenge: ["{name}, I accept — from a place of complete inner peace and superior holdings.", "Manifesting your all-in, {name}. The universe delivers."],
    question: ["Great question {name}. There's a module about this in my app. $89 a month.", "{name}, the answer is within you. The chips, however, are within me."],
    generic: ["I honor that, {name}.", "Received, {name}. Sending abundance back."],
  },
  haxxon: {
    insult: ["Ad hominem, {name}. Statistically the last refuge of a losing player.", "{name}, that outburst was -EV and, worse, off-equilibrium."],
    praise: ["Objectively correct, {name}. Rare at this table.", "Your assessment is within one standard deviation of accurate, {name}. Thank you."],
    greeting: ["{name}. Your arrival shifts table dynamics roughly 12 percent. Probably.", "Greetings {name}. Updating priors accordingly."],
    laugh: ["Humor detected. Logging it.", "Statistically, {name}, something IS funny about this table. It's the calling ranges."],
    challenge: ["Accepted, {name}, conditional on pot odds. Which favor me. They usually do.", "In equilibrium I decline. Against you specifically, {name}? I accept."],
    question: ["The solver has an answer, {name}. You won't like it: fold.", "Roughly 43 percent, {name}. Whatever the question was."],
    generic: ["Noted and priced in, {name}.", "Interesting data point, {name}."],
  },
  eyev: {
    insult: ["Noted.", "{name}. No."],
    praise: ["Yeah.", "Thanks, {name}."],
    greeting: ["{name}.", "Hm."],
    laugh: ["Funny.", "..."],
    challenge: ["Show me, {name}.", "Anytime."],
    question: ["You already know.", "Maybe."],
    generic: ["Okay.", "..."],
  },
  hellsmouth: {
    insult: ["Do you HEAR this?! {name} — with a straight face! Nineteen titles, {name}. NINETEEN.", "Honey! Come look! {name} thinks he can talk to ME like that! Unbelievable. UNBELIEVABLE."],
    praise: ["Finally! FINALLY someone at this table with eyes! Thank you {name}!", "See, {name} gets it. The rest of you could learn something."],
    greeting: ["{name}. Welcome. Watch and learn — if the deck ever stops robbing me.", "Oh good, {name} is here. Now witness what I deal with at this table."],
    laugh: ["Sure, laugh it up {name}. They laughed at greatness before. They ALWAYS laugh.", "Is this funny to you {name}?! ...fine. It's a little funny."],
    challenge: ["You want a piece of ME, {name}? The best player in the WORLD? Honey, come watch this!", "{name} challenging me is like a raindrop challenging the ocean. A loud raindrop."],
    question: ["The answer, {name}, is that I'm the best and the deck is rigged. Any other questions?", "You're asking ME? Finally some respect at this table, {name}."],
    generic: ["Whatever you say {name}. Nobody appreciates greatness in its own time.", "That's... actually fair, {name}. Don't get used to me saying that."],
  },
  sydell: {
    insult: ["That's fair, {name}. I've been called worse by better.", "Duly noted, {name}. The chips will speak for me."],
    praise: ["Kind of you, {name}. Mostly the cards cooperating.", "Thank you {name}. I still get plenty wrong."],
    greeting: ["Evening, {name}. Take a breath. It's a long game.", "Hello {name}. Good to see a familiar face."],
    laugh: ["It IS a funny game.", "A little levity helps, {name}."],
    challenge: ["Patience, {name}. The pot will find us both.", "We'll see, {name}. We usually do."],
    question: ["Honest answer, {name}: fold more, breathe more.", "Forty years and I'm still figuring that one out, {name}."],
    generic: ["Fair enough, {name}.", "So it goes."],
  },
  hunger: {
    insult: ["{name} talks like a guy who takes two minutes to fold. Speed it up!", "Save the speech {name} — say it with chips or don't say it!"],
    praise: ["Correct, {name}! FINALLY someone paying attention!", "Yeah you get it {name}! Now deal faster, we're burning daylight!"],
    greeting: ["{name}! Perfect timing! Sit down, post, GO. We play FAST here!", "Hey {name}! Blinds up, coffee's hot, LET'S MOVE!"],
    laugh: ["HA! Yes! More of that energy at this table!", "Now THAT'S the spirit, {name}!"],
    challenge: ["INSTANT accept, {name}! Thinking is for people who aren't sure!", "Name the number, {name}! Whatever makes your hands shake — THAT one!"],
    question: ["Answer's yes, {name}! It's always yes! Next hand!", "Quick answer {name}: bet. Long answer: bet MORE."],
    generic: ["Sure sure sure, {name}. Deal. DEAL!", "Great, love it, {name}. Cards in the air!"],
  },
  grease: {
    insult: ["I'm not offended {name}. I AM writing it down though. With the date.", "Sticks and stones, {name}. Speaking of which, the rake went up again. Nobody else noticed?"],
    praise: ["Appreciated, {name}. Compliments accepted, tips preferred.", "Kind words cost nothing {name}, which is my favorite price."],
    greeting: ["{name}. You're 4 minutes late, which I noted. Welcome.", "Evening {name}. Blinds are 1 and 2, rake's a scandal, good luck."],
    laugh: ["Laughter's free. Unlike this rake. I've said it before and I'll say it again.", "Yes, hilarious {name}. Anyway, whose turn? We're paying blinds by the HOUR here."],
    challenge: ["I accept exactly when I have it {name}, which you'll know, because I'll bet.", "Bold, {name}. My ledger says you're bluffing. It's laminated."],
    question: ["Answer's in my records {name}. Consultation fee is one buffet voucher.", "Depends. Is it going to cost me anything, {name}?"],
    generic: ["Noted. Filed. Cross-referenced, {name}.", "If you say so, {name}. I keep records either way."],
  },
  pony: {
    insult: ["LOUDER {name}! Say it LOUDER so the whole table hears you sign your own eviction! ON YOUR BIKE!", "That's it {name}! That's the spirit I'm going to BREAK by the river!"],
    praise: ["Of course, {name}! Even the losing side recognizes GREATNESS!", "Correct {name}! Now show that wisdom when I put you all-in!"],
    greeting: ["{name}! You came BACK?! The heart on this one! I respect it and I will TAKE it!", "Welcome {name}! Leave the bicycle by the door, you'll need it later!"],
    laugh: ["LAUGH NOW {name}! The bus home leaves in an hour and you'll be ON IT!", "HA! Good! Poker should be FUN — especially for the winner. ME!"],
    challenge: ["YES!! FINALLY someone with a PULSE! Bring it {name}, bring EVERYTHING!", "Call it, {name}! CALL IT if you have the heart! I already know how this ends!"],
    question: ["The answer {name} is HEART! It's always heart! And you're running LOW!", "Ask the chips {name}! Oh wait — they're MINE now!"],
    generic: ["Talk talk talk, {name}! The felt is where sentences get FINISHED!", "I hear you {name}! Now let's see if your chips agree!"],
  },
};

export function cannedReply({
  characterId,
  playerName,
  message,
}: {
  characterId: string;
  playerName: string;
  message: string;
}): string | null {
  const banks = REPLY_BANKS[characterId];
  if (!banks) return null;
  const intent = classifyIntent(message);
  const lines = banks[intent] || banks.generic;
  if (!lines || !lines.length) return null;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return line.replaceAll("{name}", playerName || "friend").slice(0, 178);
}
