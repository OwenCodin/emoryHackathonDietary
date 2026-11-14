// Voice and style choices made in first-call setup. Pure helpers, plus readPreferences (one bounded read).
// Only allow-listed values ever reach the RealtimeModel options or the model instructions.

// The spoken word the caller picks, mapped to a voice name in the Gemini plugin's Voice union.
export const VOICE_MENU = Object.freeze({ upbeat: 'Puck', firm: 'Kore', warm: 'Sulafat', mature: 'Gacrux' });
export const DEFAULT_PREFS = Object.freeze({ voice: 'Puck', replyStyle: 'brief', language: 'en', name: null });

// A preferred name ends up inside the model instructions, so it stays strict: letters, spaces, apostrophes and
// hyphens, at most 30 characters and 3 words.
export function cleanCallName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z][A-Za-z' -]{0,29}$/.test(name)) return null;
  if (name.split(' ').length > 3) return null;
  return name;
}

export function cleanPreferences(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    voice: Object.values(VOICE_MENU).includes(r.voice) ? r.voice : DEFAULT_PREFS.voice,
    replyStyle: r.replyStyle === 'brief' || r.replyStyle === 'detailed' ? r.replyStyle : DEFAULT_PREFS.replyStyle,
    language: r.language === 'en' || r.language === 'es' ? r.language : DEFAULT_PREFS.language,
    name: cleanCallName(r.name),
  };
}

// RealtimeModel options. The voice applies when a call starts (changing it mid-call would restart the Gemini
// session). No language option is passed: language is set by instruction only.
export function realtimeOptions({ model, prefs, realtimeInputConfig } = {}) {
  return {
    model,
    voice: cleanPreferences(prefs).voice,
    ...(realtimeInputConfig ? { realtimeInputConfig } : {}),
  };
}

// Never throws; any failure, timeout or missing memory gives the defaults.
export async function readPreferences(memory, ms = 1000) {
  let timer;
  try {
    if (!memory || typeof memory.loadPreferences !== 'function') return { ...DEFAULT_PREFS };
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); });
    const got = await Promise.race([Promise.resolve().then(() => memory.loadPreferences()).catch(() => null), late]);
    return got?.ok ? cleanPreferences(got.prefs) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  } finally {
    clearTimeout(timer);
  }
}
