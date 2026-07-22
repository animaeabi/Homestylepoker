// Character voices via Gemini TTS (gemini-2.5-flash-preview-tts). Turns a chat
// line into speech in the character's voice + delivery style and returns it as a
// base64 WAV the client can play directly. Free tier is ~3 requests/min, so the
// CLIENT throttles and only voices "punchy" lines -- this module just renders.

// One distinct prebuilt Gemini voice per character (all names from Google's
// 30-voice set), chosen to fit the persona.
const CHAR_VOICE: Record<string, string> = {
  negranope: "Aoede",      // warm, chatty
  donk:      "Charon",     // low, flat
  holes:     "Iapetus",    // serene
  haxxon:    "Rasalgethi", // measured, dry
  eyev:      "Enceladus",  // cool, minimal
  hellsmouth:"Fenrir",     // intense, dramatic
  sydell:    "Umbriel",    // gentle
  hunger:    "Puck",       // energetic
  grease:    "Algenib",    // gravelly, weary
  pony:      "Orus",       // bold, loud
};
const DEFAULT_VOICE = "Kore";

// Delivery-style preamble (interpreted by the model, not spoken aloud). Each one
// leads with "quick" / "natural" cues on purpose: with a flat prompt Gemini TTS
// tends to read slowly and robotically, so every persona is framed as a fast,
// conversational, in-character delivery -- like a real player talking trash at a
// table, not a narrator reading a line.
const CHAR_STYLE: Record<string, string> = {
  negranope: "Read this fast and natural, warm and playful with a sly grin, like a chatty mind-reader who's onto you:",
  donk:      "Read this in a quick, dry, mumbly deadpan -- unbothered and a little cocky:",
  holes:     "Read this smoothly and confidently, calm and a touch smug, like a zen assassin:",
  haxxon:    "Read this crisply and precisely, dry and clever, like a smirking analyst landing a point:",
  eyev:      "Read this coolly and evenly, ice-cold and unbothered, with quiet menace:",
  hellsmouth:"Read this fast and theatrical, indignant and worked-up, like an outraged poker brat mid-rant:",
  sydell:    "Read this softly and wryly, understated and modest, like a quiet old veteran who's seen it all:",
  hunger:    "Read this fast, brash and hyper, restless and full of gamble:",
  grease:    "Read this dry, weary and grumbling, like a tight old nit who hates spending a chip:",
  pony:      "Read this LOUD and aggressive, brash and steamrolling, right in their face:",
};

// A second preamble layered on top of the character style: the MOMENT. This is
// what makes the same voice sound cocky on a win, bitter on a loss, or sarcastic
// when needling -- the emotional colour the user asked for.
const MOOD_STYLE: Record<string, string> = {
  win:    "You just WON the pot -- sound cocky, gloating, delighted with yourself.",
  lose:   "You just LOST a rough one -- sound bitter, deflated, a little salty and stung.",
  needle: "You're needling and trash-talking -- sound sarcastic, teasing, and cocky.",
  banter: "You're bantering with the table -- sound loose, playful, and quick.",
  regret: "Sound rueful and grudgingly impressed, like it stings to admit it.",
};

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

// Wrap raw 16-bit PCM (mono) in a minimal WAV container so browsers can play it
// straight from a data: URL.
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

// Parse the sample rate out of a mime like "audio/L16;codec=pcm;rate=24000".
function rateFromMime(mime: string): number {
  const m = /rate=(\d+)/.exec(String(mime || ""));
  return m ? Number(m[1]) : 24000;
}

// Render `text` in `characterId`'s voice; returns base64 WAV or null. `mood`
// (win/lose/needle/banter/regret) layers the emotional delivery of the moment on
// top of the character's baseline voice.
export async function generateSpeechWav({
  apiKey, characterId, text, model, mood,
}: {
  apiKey: string;
  characterId: string;
  text: string;
  model?: string | null;
  mood?: string | null;
}): Promise<string | null> {
  const clean = stripForSpeech(text);
  if (!clean) return null;
  const voice = CHAR_VOICE[characterId] || DEFAULT_VOICE;
  const style = CHAR_STYLE[characterId];
  const moodStyle = mood ? MOOD_STYLE[String(mood)] : "";
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
  if (!resp.ok) throw new Error(`tts ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.find((p: any) => p?.inlineData || p?.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) return null;
  const pcm = b64ToBytes(inline.data);
  const wav = pcm16ToWav(pcm, rateFromMime(inline.mimeType || inline.mime_type));
  return bytesToB64(wav);
}
