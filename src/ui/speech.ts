// Pronunciation with the Web Speech API. English names use an English voice; Latin
// (Terminologia Anatomica) terms use an Italian voice when available, which is the closest
// widely available approximation of the classical/ecclesiastical pronunciation taught in
// anatomy courses.

let voices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

const PREFERRED_EN = [/Google US English/i, /Microsoft (Aria|Jenny|Guy).*Online/i, /Samantha/i, /Daniel/i, /Google UK English Female/i, /en-US/i, /en-GB/i, /^en/i];
const PREFERRED_LA = [/Google italiano/i, /Microsoft (Elsa|Isabella|Diego)/i, /Alice/i, /it-IT/i, /^it/i];

function pick(prefs: RegExp[]) {
  for (const re of prefs) {
    const v = voices.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return null;
}

export const speechSupported = () => 'speechSynthesis' in window;

export function speak(text: string, lang: 'en' | 'la' = 'en', onEnd?: () => void) {
  if (!speechSupported()) return false;
  speechSynthesis.cancel();
  const clean = text.replace(/\(.*?\)/g, '').replace(/[\/_]/g, ' ').trim();
  const u = new SpeechSynthesisUtterance(clean);
  const v = lang === 'la' ? pick(PREFERRED_LA) ?? pick(PREFERRED_EN) : pick(PREFERRED_EN);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang === 'la' ? 'it-IT' : 'en-US';
  u.rate = lang === 'la' ? 0.85 : 0.92;
  u.pitch = 1;
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  speechSynthesis.speak(u);
  return true;
}
