// Multi-provider character TTS. Turns a chat line into speech in the character's
// voice and returns it as a base64 audio clip (+ mime) the client can play.
//
// The provider is chosen by the MOMENT so a small, free budget stretches for
// months: everyday chatter runs on the free tiers, and the paid provider is only
// touched for rare high-impact moments.
//
//   tier    when (mood)                     provider   why
//   ------  ------------------------------  ---------  ---------------------------
//   high    win (just took the pot)         Gemini     real laughs, best delivery
//   medium  needle / regret (trash talk)    Groq       real laughs, free
//   small   banter / lose / reactions / …   Azure      free 500K chars/mo, reliable
//
// Every signature character is MALE. Each provider has a different, non-overlapping
// voice roster, so per character we pick the closest-sounding voice on each so the
// same bot still reads as itself whichever tier it speaks in. Groq only has three
// male voices, so a few characters share one there on their banter lines.

// ---------------------------------------------------------------------------
// Casting: per character, one voice on each provider (matched by timbre).
// ---------------------------------------------------------------------------
const GEMINI_VOICE: Record<string, string> = {
  negranope: "Fenrir", donk: "Charon", holes: "Iapetus", haxxon: "Rasalgethi",
  eyev: "Algenib", hellsmouth: "Alnilam", sydell: "Umbriel", hunger: "Puck",
  grease: "Gacrux", pony: "Orus",
};
const GEMINI_DEFAULT = "Charon";

// Azure "ShortName"s. Locale is parsed from the prefix. Chosen for character fit;
// several support emotion styles (see AZURE_STYLES) for express-as delivery.
const AZURE_VOICE: Record<string, string> = {
  negranope: "en-US-DavisNeural",              // warm, chatty
  donk:      "en-US-KaiNeural",                // flat, conversational
  holes:     "en-US-AndrewMultilingualNeural", // calm, empathetic
  haxxon:    "en-US-JasonNeural",              // measured, dry
  eyev:      "en-US-GuyNeural",                // cool, neutral
  hellsmouth:"en-US-TonyNeural",               // excitable brat (angry/shouting)
  sydell:    "en-US-DerekMultilingualNeural",  // gentle, shy
  hunger:    "en-US-Ethan:MAI-Voice-2",        // hyper, energetic
  grease:    "en-US-Grant:MAI-Voice-1",        // weary, grumbling
  pony:      "en-GB-RyanNeural",               // British steamroller
};
const AZURE_DEFAULT = "en-US-GuyNeural";

// Emotion styles each Azure voice actually supports (from the voices/list API).
// Used to clamp a mood->style choice so we never send an unsupported style.
const AZURE_STYLES: Record<string, string[]> = {
  "en-US-DavisNeural": ["chat", "angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-KaiNeural": ["conversation"],
  "en-US-AndrewMultilingualNeural": ["empathetic", "relieved"],
  "en-US-JasonNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-GuyNeural": ["newscast", "angry", "cheerful", "sad", "excited", "friendly", "terrified", "shouting", "unfriendly", "whispering", "hopeful"],
  "en-US-TonyNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-DerekMultilingualNeural": ["empathetic", "excited", "relieved", "shy"],
  "en-US-Ethan:MAI-Voice-2": ["angry", "confused", "determined", "disgusted", "embarrassed", "excited", "fearful", "happy", "hopeful", "jealous", "joyful", "regretful", "relieved", "sad", "shouting", "softvoice", "surprised", "whispering"],
  "en-US-Grant:MAI-Voice-1": ["anger", "confusion", "determination", "disgust", "embarrassment", "excitement", "fear", "generalconversation", "happiness", "hope", "jealousy", "joy", "neutral", "professional", "regret", "relief", "sadness", "shouting", "softvoice", "surprise", "whispering"],
  "en-GB-RyanNeural": ["cheerful", "chat", "whispering", "sad"],
};

// Groq Orpheus only has three male voices; characters are grouped onto the closest.
const GROQ_VOICE: Record<string, string> = {
  negranope: "austin", donk: "daniel", holes: "austin", haxxon: "daniel",
  eyev: "daniel", hellsmouth: "troy", sydell: "austin", hunger: "troy",
  grease: "daniel", pony: "troy",
};
const GROQ_DEFAULT = "daniel";

// ---------------------------------------------------------------------------
// Delivery direction.
// ---------------------------------------------------------------------------
// Gemini takes free-form natural-language direction (interpreted, not spoken).
const GEMINI_STYLE: Record<string, string> = {
  negranope: "Read this fast and natural, warm and playful with a sly grin, like a chatty mind-reader who's onto you:",
  donk:      "Read this in a quick, dry, mumbly deadpan -- unbothered and a little cocky:",
  holes:     "Read this smoothly and confidently, calm and a touch smug, like a zen assassin:",
  haxxon:    "Read this crisply and precisely, dry and clever, like a smirking analyst landing a point:",
  eyev:      "Read this coolly and evenly, ice-cold and unbothered, with quiet menace:",
  hellsmouth:"Read this as a mature Midwestern American man in his 60s, chest-resonant and deliberate when composed -- but the instant there's any outrage, speed up, climb into a nasal, high-pitched aggrieved whine and clip the words, like the Poker Brat mid-tantrum:",
  sydell:    "Read this softly and wryly, understated and modest, like a quiet old veteran who's seen it all:",
  hunger:    "Read this fast, brash and hyper, restless and full of gamble:",
  grease:    "Read this dry, weary and grumbling, like a tight old nit who hates spending a chip:",
  pony:      "Speak with a strong British accent, cocky and aggressive but with a STEADY, flat tone -- no sing-song, punchy and right in their face:",
};

// The moment, layered on top of the character voice.
const GEMINI_MOOD: Record<string, string> = {
  win:    "You just WON the pot -- sound cocky and gloating, delighted with yourself, and laugh naturally.",
  lose:   "You just LOST a rough one -- sound bitter, deflated, a little salty and stung.",
  needle: "You're needling and trash-talking -- sound sarcastic, teasing, and cocky.",
  banter: "You're bantering with the table -- sound loose, playful, and quick.",
  regret: "Sound rueful and grudgingly impressed, like it stings to admit it.",
};

// Azure: map the moment to an express-as style; clamped per-voice below.
const AZURE_MOOD_STYLE: Record<string, string[]> = {
  // preference order; first one the voice supports wins
  win:    ["excited", "cheerful", "joyful", "joy", "excitement"],
  lose:   ["sad", "sadness", "unfriendly", "disappointed"],
  needle: ["angry", "unfriendly", "anger", "shouting"],
  banter: ["chat", "cheerful", "friendly", "generalconversation", "conversation"],
  regret: ["sad", "regret", "regretful", "hopeful"],
};

function pickAzureStyle(voice: string, mood: string): string | null {
  const supported = AZURE_STYLES[voice];
  if (!supported || !supported.length) return null;
  const prefs = AZURE_MOOD_STYLE[mood] || AZURE_MOOD_STYLE.banter;
  for (const s of prefs) if (supported.includes(s)) return s;
  return null;
}

// Route the moment (mood) to a tier/provider.
function tierForMood(mood: string): "high" | "medium" | "small" {
  if (mood === "win") return "high";
  if (mood === "needle" || mood === "regret") return "medium";
  return "small";
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------
function stripForSpeech(text: string): string {
  return String(text || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Wrap raw 16-bit PCM (mono) in a minimal WAV container.
function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1, bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  w(36, "data"); view.setUint32(40, dataSize, true);
  const out = new Uint8Array(buf);
  out.set(pcm, 44);
  return out;
}

function rateFromMime(mime: string): number {
  const m = /rate=(\d+)/.exec(String(mime || ""));
  return m ? Number(m[1]) : 24000;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export interface SpeechClip { audio: string; mime: string; }

// ---------------------------------------------------------------------------
// Provider: Gemini (high moments -- real laughs, best delivery). Base64 WAV.
// ---------------------------------------------------------------------------
async function geminiTts(characterId: string, clean: string, mood: string, apiKey: string, model?: string | null): Promise<SpeechClip | null> {
  const voice = GEMINI_VOICE[characterId] || GEMINI_DEFAULT;
  const style = GEMINI_STYLE[characterId];
  const moodStyle = mood ? GEMINI_MOOD[mood] : "";
  const preamble = [style, moodStyle].filter(Boolean).join(" ");
  const prompt = preamble ? `${preamble} ${clean}` : clean;
  const modelName = model || "gemini-2.5-flash-preview-tts";

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    },
  );
  if (!resp.ok) throw new Error(`gemini ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.find((p: any) => p?.inlineData || p?.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) return null;
  const pcm = b64ToBytes(inline.data);
  const wav = pcm16ToWav(pcm, rateFromMime(inline.mimeType || inline.mime_type));
  return { audio: bytesToB64(wav), mime: "audio/wav" };
}

// ---------------------------------------------------------------------------
// Provider: Azure AI Speech (small talk -- free tier, reliable). Base64 MP3.
// ---------------------------------------------------------------------------
async function azureTts(characterId: string, clean: string, mood: string, key: string, region: string): Promise<SpeechClip | null> {
  const voice = AZURE_VOICE[characterId] || AZURE_DEFAULT;
  const locale = voice.split("-").slice(0, 2).join("-"); // en-US / en-GB
  const style = pickAzureStyle(voice, mood);
  const inner = xmlEscape(clean);
  const body = style
    ? `<mstts:express-as style="${style}" styledegree="1.6">${inner}</mstts:express-as>`
    : inner;
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${voice}">${body}</voice></speak>`;

  const resp = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "homestylepoker",
    },
    body: ssml,
  });
  if (!resp.ok) throw new Error(`azure ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (!bytes.length) return null;
  return { audio: bytesToB64(bytes), mime: "audio/mpeg" };
}

// ---------------------------------------------------------------------------
// Provider: Groq + Orpheus (medium banter -- free, real laughs). Base64 WAV.
// A browser-like User-Agent avoids Cloudflare bot mitigation.
// ---------------------------------------------------------------------------
async function groqTts(characterId: string, clean: string, mood: string, apiKey: string): Promise<SpeechClip | null> {
  const voice = GROQ_VOICE[characterId] || GROQ_DEFAULT;
  // Orpheus adds emotion from inline tags; a light chuckle sells a needle.
  const input = mood === "needle" ? `${clean} <chuckle>` : clean;

  const resp = await fetch("https://api.groq.com/openai/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      model: "canopylabs/orpheus-v1-english",
      input,
      voice,
      response_format: "wav",
    }),
  });
  if (!resp.ok) throw new Error(`groq ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (!bytes.length) return null;
  return { audio: bytesToB64(bytes), mime: "audio/wav" };
}

// ---------------------------------------------------------------------------
// Public entry: pick the provider by moment, with graceful fallback so a flaky
// or unconfigured tier never leaves the line silent.
// ---------------------------------------------------------------------------
export interface TtsKeys {
  gemini?: string | null;
  azureKey?: string | null;
  azureRegion?: string | null;
  groq?: string | null;
  model?: string | null; // Gemini model override
}

export async function generateSpeech({
  characterId, text, mood, keys,
}: {
  characterId: string;
  text: string;
  mood?: string | null;
  keys: TtsKeys;
}): Promise<SpeechClip | null> {
  const clean = stripForSpeech(text);
  if (!clean) return null;
  const m = String(mood || "");
  const tier = tierForMood(m);

  const gemini = () => keys.gemini ? geminiTts(characterId, clean, m, keys.gemini, keys.model) : Promise.resolve(null);
  const azure = () => (keys.azureKey && keys.azureRegion) ? azureTts(characterId, clean, m, keys.azureKey, keys.azureRegion) : Promise.resolve(null);
  const groq = () => keys.groq ? groqTts(characterId, clean, m, keys.groq) : Promise.resolve(null);

  // Primary by tier, then fall back to the free/reliable providers, then Gemini.
  const order = tier === "high" ? [gemini, azure, groq]
    : tier === "medium" ? [groq, azure, gemini]
    : [azure, groq, gemini];

  let lastErr: unknown = null;
  for (const provider of order) {
    try {
      const clip = await provider();
      if (clip) return clip;
    } catch (err) {
      lastErr = err;
      // 429 from the primary should bubble so the client can back off.
      const msg = err instanceof Error ? err.message : String(err);
      if (/429/.test(msg) && provider === order[0]) throw err;
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  return null;
}

// Back-compat shim for callers that only want a base64 WAV string via Gemini.
export async function generateSpeechWav({
  apiKey, characterId, text, model, mood,
}: {
  apiKey: string;
  characterId: string;
  text: string;
  model?: string | null;
  mood?: string | null;
}): Promise<string | null> {
  const clip = await generateSpeech({ characterId, text, mood, keys: { gemini: apiKey, model } });
  return clip?.audio || null;
}
