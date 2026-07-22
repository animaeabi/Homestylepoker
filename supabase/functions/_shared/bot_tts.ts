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

// Delivery-style preamble (interpreted by the model, not spoken aloud).
const CHAR_STYLE: Record<string, string> = {
  negranope: "Say it warmly and playfully, like a chatty mind-reader:",
  donk:      "Say it in a flat, mumbly, deadpan monotone:",
  holes:     "Say it in a calm, serene, life-coach tone:",
  haxxon:    "Say it dryly and precisely, like a calm analyst:",
  eyev:      "Say it flatly and icily, with cold, minimal energy:",
  hellsmouth:"Say it like an outraged, theatrical poker brat -- indignant and loud:",
  sydell:    "Say it softly and modestly, like a quiet old veteran:",
  hunger:    "Say it fast, brash, and hyper-caffeinated:",
  grease:    "Say it dry, weary, and grumbling:",
  pony:      "Say it LOUD, aggressive, and steamrolling:",
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

// Render `text` in `characterId`'s voice; returns base64 WAV or null.
export async function generateSpeechWav({
  apiKey, characterId, text, model,
}: {
  apiKey: string;
  characterId: string;
  text: string;
  model?: string | null;
}): Promise<string | null> {
  const clean = stripForSpeech(text);
  if (!clean) return null;
  const voice = CHAR_VOICE[characterId] || DEFAULT_VOICE;
  const style = CHAR_STYLE[characterId];
  const prompt = style ? `${style} ${clean}` : clean;
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
