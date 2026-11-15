// What the caller sees when no cart frame is showing: the RenaLine brand screen, or a verdict card
// for a few seconds after a verdict. Rendering happens in the background; frame() is synchronous,
// never throws and always returns a fresh exact-size RGBA array.
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { brandSvg, cardSvg, paintMouth, paintVoiceIndicator, renderSvg } from './card.mjs';
import { createFaceFrames } from './face.mjs';

const LENGTH = WIDTH * HEIGHT * 4;

export function cardMsFrom(env = process.env) {
  const n = Number(env?.AGENT_CARD_SECONDS);
  return Number.isFinite(n) && n > 0 ? Math.min(120, n) * 1000 : 15000;
}

export function createScreen({
  render = renderSvg,
  fallback = createFaceFrames(),
  now = Date.now,
  cardMs = cardMsFrom(process.env),
  renderTimeoutMs = 3000,
  log = m => console.log(m),
} = {}) {
  let idle = null, idleFailed = false, card = null, seq = 0, cardLogged = false;
  const pending = new Set();

  const safeLog = m => { try { log(m); } catch { /* logging never breaks video */ } };

  // Render with a timeout and a size check; resolves a Uint8Array or rejects.
  const draw = async svg => {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('render timeout')), renderTimeoutMs); });
    try {
      const work = Promise.resolve().then(() => render(svg));
      work.catch(() => {});
      const pixels = await Promise.race([work, timeout]);
      if (!(pixels instanceof Uint8Array) || pixels.length !== LENGTH) throw new Error('render size');
      return pixels;
    } finally {
      clearTimeout(timer);
    }
  };
  const track = p => { pending.add(p); p.finally(() => pending.delete(p)); };

  try {
    const p = draw(brandSvg()).then(
      pixels => { idle = pixels; },
      () => { idleFailed = true; safeLog('[agent] video: brand screen failed, using face'); },
    );
    track(p);
  } catch {
    idleFailed = true;
  }

  function show(display) {
    try {
      const ok = display && typeof display === 'object'
        && ((Array.isArray(display.items) && display.items.length > 0) || display.unjudged === true);
      if (!ok) return;
      const mine = ++seq;
      const shownAt = now();
      const p = draw(cardSvg(display)).then(
        pixels => { if (mine === seq) card = { pixels, until: shownAt + cardMs }; },
        () => {
          if (!cardLogged) { cardLogged = true; safeLog('[agent] video: card render failed'); }
        },
      );
      track(p);
    } catch { /* video never breaks the call */ }
  }

  function frame(tick, speaking) {
    try {
      if (card && now() >= card.until) card = null;
      const base = card?.pixels ?? idle;
      if (!base) return fallback.frame(tick, speaking);
      const pixels = base.slice();
      paintMouth(pixels, tick, speaking);
      paintVoiceIndicator(pixels, tick, speaking);
      return pixels;
    } catch {
      try { return fallback.frame(tick, speaking); } catch { return new Uint8Array(LENGTH); }
    }
  }

  return { show, frame, flush: () => Promise.allSettled([...pending]) };
}
