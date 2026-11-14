// The RenaLine screens the caller sees: an idle brand screen and a verdict card, both plain SVG
// rendered by sharp. The builders are pure; only renderSvg touches sharp. Every drawn string goes
// cleanText -> fitText -> escapeXml, in that order, and the builders read only the fields of the
// display object listed below (never a name, phone number or patient id).
import sharp from 'sharp';
import { HEIGHT, WIDTH } from '../shared/video.mjs';

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const BACKGROUND = '#0F2430';
const WHITE = '#FFFFFF';
const SOFT = '#CBD5E1';
const LIGHT = '#E2E8F0';
const CONTENT_WIDTH = 1160;

export const VERDICTS = {
  ok: { word: 'YES', color: '#4ADE80', icon: 'ok' },
  limit: { word: 'SMALL PORTION', color: '#FBBF24', icon: 'limit' },
  avoid: { word: 'NO', color: '#F87171', icon: 'avoid' },
  unknown: { word: "CAN'T TELL", color: '#CBD5E1', icon: 'unknown' },
};
const verdictOf = key => (Object.hasOwn(VERDICTS, key) ? VERDICTS[key] : VERDICTS.unknown);

// The voice wave: 32 bars in a band between the title and the footer. Painted per frame.
export const WAVE = { top: 505, bottom: 585, center: 545, bars: 32, barWidth: 18, gap: 14, color: [94, 234, 212], flat: 6 };
const WAVE_SPAN = WAVE.bars * WAVE.barWidth + (WAVE.bars - 1) * WAVE.gap;
const WAVE_LEFT = Math.round((WIDTH - WAVE_SPAN) / 2);

// ---- text safety ------------------------------------------------------------------------------

export function cleanText(value, max) {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const text = raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, Math.max(0, max)).join('');
}

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A cautious width estimate in pixels, so a line is never drawn past its box.
export function textWidth(s, size, bold = false) {
  let em = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (ch === ' ') em += 0.3;
    else if (cp >= 0x2e80) em += 1.05;
    else if (/[0-9A-Z]/.test(ch)) em += bold ? 0.72 : 0.66;
    else if (/[a-z]/.test(ch)) em += bold ? 0.6 : 0.55;
    else em += bold ? 0.68 : 0.62;
  }
  return em * size;
}

export function fitText(s, { max, min, width, bold = false }) {
  const text = String(s);
  for (let size = max; size >= min; size--) {
    if (textWidth(text, size, bold) <= width) return { text, size };
  }
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const cut = `${chars.join('').trimEnd()}…`;
    if (textWidth(cut, min, bold) <= width) return { text: cut, size: min };
  }
  return { text: '…', size: min };
}

const capitalise = s => {
  const chars = Array.from(s);
  return chars.length ? chars[0].toLocaleUpperCase() + chars.slice(1).join('') : s;
};
const foodName = (value, max = 80) => capitalise(cleanText(value, max)) || 'This food';

// ---- pieces -----------------------------------------------------------------------------------

export function detailParts(item) {
  const n = item?.nutrients;
  const wanted = [['Sodium', 'sodiumMg'], ['Potassium', 'potassiumMg'], ['Phosphorus', 'phosphorusMg']];
  let nutrients = [];
  if (n && typeof n === 'object') {
    for (const [label, key] of wanted) {
      const x = n[key];
      if (typeof x === 'number' && Number.isFinite(x) && x >= 0) nutrients.push(`${label} ${Math.round(x)} mg`);
    }
  }
  while (nutrients.length > 0 && textWidth(nutrients.join(' · '), 44) > CONTENT_WIDTH) nutrients = nutrients.slice(0, -1);
  let portion = null;
  const p = cleanText(item?.portion, 40);
  if (p && !/^(unknown|not estimated)$/i.test(p)) portion = `Portion: ${p}`;
  return { nutrients, portion };
}

const text = (x, y, size, fill, body, { weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${body}</text>`;

// Icons are drawn in a 100 x 100 box so the verdict is never colour alone.
function icon(kind, color, x, y, size, id) {
  const open = `<g id="${id}" transform="translate(${x} ${y}) scale(${size / 100})">`;
  let body;
  if (kind === 'ok') {
    body = `<circle cx="50" cy="50" r="46" fill="${color}"/><path d="M28 52 L44 68 L74 34" fill="none" stroke="${BACKGROUND}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (kind === 'limit') {
    body = `<circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="8"/><path d="M8 50 A42 42 0 0 0 92 50 Z" fill="${color}"/>`;
  } else if (kind === 'avoid') {
    body = `<polygon points="30,4 70,4 96,30 96,70 70,96 30,96 4,70 4,30" fill="${color}"/><path d="M32 32 L68 68 M68 32 L32 68" stroke="${BACKGROUND}" stroke-width="11" stroke-linecap="round"/>`;
  } else {
    body = `<circle cx="50" cy="50" r="46" fill="${color}"/><text x="50" y="72" font-family="${FONT}" font-size="66" font-weight="800" fill="${BACKGROUND}" text-anchor="middle">?</text>`;
  }
  return `${open}${body}</g>`;
}

const open = () => `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>`;
const footer = () => text(WIDTH / 2, 645, 36, SOFT, escapeXml("Follows your care team's limits"), { anchor: 'middle' });
const wordmark = () => text(60, 108, 44, WHITE, 'RenaLine', { weight: 800 });

export function brandSvg() {
  return [
    open(),
    text(WIDTH / 2, 300, 128, WHITE, 'RenaLine', { weight: 800, anchor: 'middle' }),
    text(WIDTH / 2, 380, 56, SOFT, 'Your renal dietitian', { anchor: 'middle' }),
    footer(),
    '</svg>',
  ].join('');
}

function onlineTag() {
  const label = 'Found online';
  const w = Math.ceil(textWidth(label, 32, true)) + 40;
  return `<rect x="${1220 - w}" y="70" width="${w}" height="48" rx="24" fill="none" stroke="${SOFT}" stroke-width="3"/>`
    + text(1220 - w / 2, 105, 32, SOFT, label, { weight: 700, anchor: 'middle' });
}

export function cardSvg(display) {
  const items = Array.isArray(display?.items) ? display.items.filter(i => i && typeof i === 'object') : [];
  const unjudged = display?.unjudged === true;
  if (items.length === 0 && !unjudged) return brandSvg();
  const more = Number.isInteger(display?.more) && display.more > 0 ? display.more : 0;
  const parts = [open(), wordmark()];
  if (display?.online === true) parts.push(onlineTag());

  if (unjudged) {
    const seen = Number.isInteger(display?.seen) && display.seen > 0 ? display.seen : Math.max(1, items.length);
    const one = seen === 1;
    parts.push(text(60, 260, 88, WHITE, escapeXml(`I can see ${one ? 'one food' : `${seen} foods`}`), { weight: 800 }));
    parts.push(text(60, 340, 52, SOFT, escapeXml(`but I can't judge ${one ? 'it' : 'them'} right now`)));
    const names = items.slice(0, 3).map(i => cleanText(i.food, 80)).filter(Boolean).join(', ');
    if (names) {
      const f = fitText(names, { max: 44, min: 44, width: CONTENT_WIDTH });
      parts.push(text(60, 420, f.size, LIGHT, escapeXml(f.text)));
    }
  } else if (items.length === 1) {
    const item = items[0];
    const v = verdictOf(item.verdict);
    const word = fitText(v.word, { max: 150, min: 110, width: 1035, bold: true });
    parts.push(icon(v.icon, v.color, 60, Math.round(265 - word.size * 0.36 - 50), 100, `icon-${v.icon}`));
    parts.push(text(185, 265, word.size, v.color, escapeXml(word.text), { weight: 800 }));
    const f = fitText(foodName(item.food), { max: 72, min: 60, width: CONTENT_WIDTH, bold: true });
    parts.push(text(60, 355, f.size, WHITE, escapeXml(f.text), { weight: 700 }));
    const d = detailParts(item);
    let y = 420;
    if (d.nutrients.length) { parts.push(text(60, y, 44, LIGHT, escapeXml(d.nutrients.join(' · ')))); y += 55; }
    if (d.portion) parts.push(text(60, y, 44, LIGHT, escapeXml(d.portion)));
  } else {
    const rows = items.slice(0, 3);
    const widest = Math.max(...rows.map(r => textWidth(verdictOf(r.verdict).word, 64, true)));
    const foodX = Math.ceil(135 + widest + 40);
    rows.forEach((r, n) => {
      const v = verdictOf(r.verdict);
      const y = [210, 300, 390][n];
      parts.push(icon(v.icon, v.color, 60, y - 51, 56, n === 0 ? `icon-${v.icon}` : `icon-${v.icon}-${n + 1}`));
      parts.push(text(135, y, 64, v.color, escapeXml(v.word), { weight: 700 }));
      const f = fitText(foodName(r.food), { max: 56, min: 44, width: 1220 - foodX });
      parts.push(text(foodX, y, f.size, WHITE, escapeXml(f.text)));
    });
    const left = Math.max(0, items.length - 3) + more;
    if (left > 0) parts.push(text(60, 470, 44, SOFT, escapeXml(`+${left} more`)));
  }
  parts.push(footer(), '</svg>');
  return parts.join('');
}

// ---- voice wave -------------------------------------------------------------------------------

function fillRect(pixels, x0, y0, x1, y1, [r, g, b]) {
  const xa = Math.max(0, Math.min(WIDTH, Math.round(x0)));
  const xb = Math.max(0, Math.min(WIDTH, Math.round(x1)));
  const ya = Math.max(WAVE.top, Math.min(WAVE.bottom, Math.round(y0)));
  const yb = Math.max(WAVE.top, Math.min(WAVE.bottom, Math.round(y1)));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * WIDTH + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
}

// Mutates the RGBA buffer in place, only inside the wave band.
export function paintWave(pixels, tick, speaking) {
  const t = Number.isFinite(tick) ? tick : 0;
  if (speaking) {
    for (let i = 0; i < WAVE.bars; i++) {
      const level = Math.abs(Math.sin(t * 0.55 + i * 0.7)) * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.23 + i * 1.3)));
      const h = 10 + level * 66;
      const x = WAVE_LEFT + i * (WAVE.barWidth + WAVE.gap);
      fillRect(pixels, x, WAVE.center - h / 2, x + WAVE.barWidth, WAVE.center + h / 2, WAVE.color);
    }
  } else {
    fillRect(pixels, WAVE_LEFT, WAVE.center - WAVE.flat / 2, WAVE_LEFT + WAVE_SPAN, WAVE.center + WAVE.flat / 2, WAVE.color);
    const dotX = WAVE_LEFT + ((Math.abs(Math.floor(t)) * 9) % (WAVE_SPAN - 14));
    fillRect(pixels, dotX, WAVE.center - 7, dotX + 14, WAVE.center + 7, [255, 255, 255]);
  }
}

// ---- rendering --------------------------------------------------------------------------------

export async function renderSvg(svg, { timeoutMs = 3000 } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('render timeout')), timeoutMs); });
  try {
    const work = sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    work.catch(() => {});
    const { data, info } = await Promise.race([work, timeout]);
    if (info.width !== WIDTH || info.height !== HEIGHT || data.length !== WIDTH * HEIGHT * 4) throw new Error('render size');
    return new Uint8Array(data);
  } finally {
    clearTimeout(timer);
  }
}
