// The RenaLine screens the caller sees: an idle brand screen and a verdict card, both plain SVG
// rendered by sharp. The builders are pure; only renderSvg touches sharp. Every drawn string goes
// cleanText -> fitText -> escapeXml, in that order, and the builders read only the fields of the
// display object listed below (never a name, phone number or patient id).
import sharp from 'sharp';
import { HEIGHT, SAFE_SCALE, WIDTH, safeArea, safeTransform } from '../shared/video.mjs';

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const BACKGROUND = '#142827';
const WHITE = '#FFFFFF';
const SOFT = '#D3DCD0';
const LIGHT = '#F4EBDD';
const MINT = '#BFD2BB';
const PANEL = '#1D3734';

export const VERDICTS = {
  ok: { word: 'YES', detail: 'Fits your limits', color: '#63E6A7', icon: 'ok' },
  limit: { word: 'MAYBE', detail: 'Small portion', color: '#F6C768', icon: 'limit' },
  avoid: { word: 'NO', detail: 'Outside your limits', color: '#FF7C82', icon: 'avoid' },
  unknown: { word: 'CHECK', detail: "I couldn't tell", color: '#CBD5E1', icon: 'unknown' },
};
const verdictOf = key => (Object.hasOwn(VERDICTS, key) ? VERDICTS[key] : VERDICTS.unknown);

// A warm voice halo is painted per frame over the abstract companion mark.
export const VOICE_INDICATOR = { top: 212, bottom: 448, center: 330, x: 382, radius: 118, coreRadius: 20 };

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

// The background fills the whole frame; everything else sits in one group inside the safe area.
const close = '</g></svg>';

function sceneDefs() {
  return `<defs>
    <linearGradient id="scene" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#233C37"/><stop offset="1" stop-color="#101F20"/></linearGradient>
    <radialGradient id="halo"><stop stop-color="#8C704B" stop-opacity=".56"/><stop offset="1" stop-color="#142827" stop-opacity="0"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".13"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".025"/></linearGradient>
    <filter id="soft-shadow" x="-.3" y="-.3" width="1.6" height="1.8"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>`;
}

function companionHalo() {
  return `<g aria-label="RenaLine voice companion">
    <circle cx="382" cy="330" r="258" fill="url(#halo)"/>
    <circle cx="382" cy="330" r="198" fill="none" stroke="#BFD2BB" stroke-opacity=".1" stroke-width="2"/>
    <circle cx="382" cy="330" r="150" fill="none" stroke="#D8BC91" stroke-opacity=".2" stroke-width="2"/>
    <circle cx="382" cy="330" r="104" fill="#172F30" fill-opacity=".72"/>
    <circle cx="382" cy="330" r="104" fill="none" stroke="#C9D7C2" stroke-opacity=".32" stroke-width="2"/>
    <circle cx="382" cy="330" r="4" fill="#E8D4B5" fill-opacity=".75"/>
  </g>`;
}

function sceneOpen(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${sceneDefs()}<rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/><g transform="${safeTransform(scale)}"><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scene)"/>`;
}

function panel(x, y, width, height) {
  return `<rect x="${x + 8}" y="${y + 12}" width="${width}" height="${height}" rx="30" fill="#02090D" opacity=".3" filter="url(#soft-shadow)"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="${PANEL}" stroke="#B6E9DA" stroke-opacity=".18" stroke-width="2"/><rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="27" fill="url(#glass)"/>`;
}

function statusPill(verdict, x, y, compact = false) {
  const v = verdictOf(verdict);
  const label = v.word;
  const width = compact ? Math.max(110, textWidth(label, 24, true) + 38) : Math.max(150, textWidth(label, 32, true) + 48);
  const h = compact ? 44 : 52;
  const size = compact ? 22 : 26;
  return {
    width,
    svg: `<rect x="${x}" y="${y}" width="${width}" height="${h}" rx="${h / 2}" fill="${v.color}" fill-opacity=".14" stroke="${v.color}" stroke-opacity=".7" stroke-width="2"/>`
      + icon(v.icon, v.color, x + 8, y + (h - size) / 2, size, `icon-${v.icon}`)
      + text(x + width / 2 + size / 2, y + (compact ? 29 : 35), compact ? 24 : 32, v.color, escapeXml(label), { weight: 800, anchor: 'middle' }),
  };
}

function onlineBadge(x, y, compact = false) {
  const label = 'FOUND ONLINE';
  const width = compact ? 170 : 190;
  const height = compact ? 36 : 40;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#243E49" stroke="#83B9C1" stroke-opacity=".55" stroke-width="1"/>`
    + text(x + width / 2, y + (compact ? 25 : 28), compact ? 20 : 21, LIGHT, label, { weight: 700, anchor: 'middle' });
}

function nutrientCards(item, x, y, width, compact = false) {
  const details = detailParts(item);
  const nutrients = details.nutrients.slice(0, 3);
  if (!nutrients.length) return details.portion
    ? text(x, y + 28, compact ? 23 : 25, LIGHT, escapeXml(details.portion))
    : '';
  const gap = 9;
  const each = (width - gap * (nutrients.length - 1)) / nutrients.length;
  return nutrients.map((value, i) => {
    const split = value.match(/^(Sodium|Potassium|Phosphorus)\s+(.+)$/);
    if (!split) return '';
    const xx = x + i * (each + gap);
    const label = split[1].toUpperCase();
    const amount = split[2];
    return `<rect x="${xx}" y="${y}" width="${each}" height="${compact ? 58 : 66}" rx="14" fill="#0C2029" stroke="#C1E5DD" stroke-opacity=".13"/>`
      + text(xx + 12, y + (compact ? 22 : 24), compact ? 14 : 16, SOFT, label, { weight: 700 })
      + text(xx + 12, y + (compact ? 46 : 52), compact ? 22 : 24, WHITE, escapeXml(amount), { weight: 700 });
  }).join('') + (details.portion
    ? text(x, y + (compact ? 88 : 99), compact ? 20 : 22, LIGHT, escapeXml(details.portion))
    : '');
}

export function brandSvg({ scale = SAFE_SCALE } = {}) {
  return [
    sceneOpen(scale),
    companionHalo(),
    text(710, 186, 24, MINT, 'YOUR RENAL DIETITIAN', { weight: 800 }),
    panel(692, 210, 510, 264),
    text(730, 278, 58, WHITE, 'RenaLine', { weight: 800 }),
    text(730, 326, 30, LIGHT, 'A calm companion for food choices'),
    `<circle cx="747" cy="395" r="9" fill="${MINT}"/>`,
    text(768, 404, 25, SOFT, 'Here with you, live'),
    text(730, 447, 22, SOFT, escapeXml("Follows your care team's limits")),
    text(382, 584, 22, SOFT, 'Steady support, guided by your care team', { anchor: 'middle' }),
    close,
  ].join('');
}

export function cardSvg(display, { scale = SAFE_SCALE } = {}) {
  const items = Array.isArray(display?.items) ? display.items.filter(i => i && typeof i === 'object') : [];
  const unjudged = display?.unjudged === true;
  if (items.length === 0 && !unjudged) return brandSvg({ scale });
  const more = Number.isInteger(display?.more) && display.more > 0 ? display.more : 0;
  const parts = [sceneOpen(scale), companionHalo(), text(710, 142, 23, MINT, 'FOOD CHECK', { weight: 800 }), panel(692, 165, 510, 330)];
  if (display?.online === true) parts.push(onlineBadge(1000, 181, true));

  if (unjudged) {
    const seen = Number.isInteger(display?.seen) && display.seen > 0 ? display.seen : Math.max(1, items.length);
    const one = seen === 1;
    parts.push(text(730, 238, 36, WHITE, `I can see ${one ? 'one food' : `${seen} foods`}`, { weight: 700 }));
    parts.push(text(730, 286, 27, SOFT, escapeXml(`but I can't judge ${one ? 'it' : 'them'} right now`)));
    const names = items.slice(0, 3).map(i => cleanText(i.food, 50)).filter(Boolean);
    names.forEach((name, i) => {
      parts.push(`<circle cx="748" cy="${344 + i * 44}" r="5" fill="#AABCC1"/>`);
      parts.push(text(766, 353 + i * 44, 23, LIGHT, escapeXml(name)));
    });
  } else if (items.length === 1) {
    const item = items[0];
    const v = verdictOf(item.verdict);
    const status = statusPill(item.verdict, 730, 198);
    parts.push(status.svg);
    parts.push(text(730, 316, 44, WHITE, escapeXml(fitText(foodName(item.food), { max: 44, min: 30, width: 430, bold: true }).text), { weight: 700 }));
    parts.push(text(730, 354, 24, SOFT, v.detail));
    parts.push(nutrientCards(item, 730, 385, 430));
  } else {
    const rows = items.slice(0, 3);
    parts.push(text(730, 220, 30, WHITE, 'At a glance', { weight: 700 }));
    rows.forEach((r, n) => {
      const y = 246 + n * 82;
      const v = verdictOf(r.verdict);
      parts.push(`<rect x="718" y="${y - 28}" width="458" height="70" rx="16" fill="#0C2029" stroke="#C1E5DD" stroke-opacity=".12"/>`);
      const status = statusPill(r.verdict, 730, y - 16, true);
      parts.push(status.svg);
      const f = fitText(foodName(r.food), { max: 27, min: 20, width: 265, bold: true });
      parts.push(text(750 + status.width, y + 13, f.size, WHITE, escapeXml(f.text), { weight: 700 }));
      const nPart = detailParts(r).nutrients[0];
      if (nPart) parts.push(text(750 + status.width, y + 34, 16, SOFT, escapeXml(nPart)));
    });
    const left = Math.max(0, items.length - 3) + more;
    if (left > 0) parts.push(text(730, 482, 20, SOFT, escapeXml(`+${left} more`)));
  }
  parts.push(close);
  return parts.join('');
}

// ---- voice indicator --------------------------------------------------------------------------

// The indicator band in frame pixels, after the safe-area mapping.
export function voiceIndicatorBand(scale = SAFE_SCALE) {
  const a = safeArea(scale);
  return {
    top: Math.floor(a.y + VOICE_INDICATOR.top * scale),
    bottom: Math.ceil(a.y + VOICE_INDICATOR.bottom * scale),
    left: Math.floor(a.x + (VOICE_INDICATOR.x - VOICE_INDICATOR.radius) * scale),
    right: Math.ceil(a.x + (VOICE_INDICATOR.x + VOICE_INDICATOR.radius) * scale),
  };
}



function blendPixel(pixels, index, color, alpha) {
  const keep = 1 - alpha;
  pixels[index] = Math.round(pixels[index] * keep + color[0] * alpha);
  pixels[index + 1] = Math.round(pixels[index + 1] * keep + color[1] * alpha);
  pixels[index + 2] = Math.round(pixels[index + 2] * keep + color[2] * alpha);
  pixels[index + 3] = 255;
}

// Mutates the RGBA buffer in place, only inside the voice indicator band.
export function paintVoiceIndicator(pixels, tick, speaking, scale = SAFE_SCALE) {
  const t = Number.isFinite(tick) ? tick : 0;
  const area = safeArea(scale);
  const band = voiceIndicatorBand(scale);
  const pulse = 0.5 + 0.5 * Math.sin(t * (speaking ? 0.34 : 0.12));
  const ringRadius = speaking ? 58 + 40 * pulse : 72 + 5 * pulse;
  const coreRadius = VOICE_INDICATOR.coreRadius + (speaking ? 2 : 1) * pulse;
  const centerX = area.x + VOICE_INDICATOR.x * scale;
  const centerY = area.y + VOICE_INDICATOR.center * scale;
  const outerRadius = VOICE_INDICATOR.radius * scale;
  const x0 = Math.max(band.left, Math.floor(centerX - outerRadius));
  const x1 = Math.min(band.right, Math.ceil(centerX + outerRadius));
  const y0 = Math.max(band.top, Math.floor(centerY - outerRadius));
  const y1 = Math.min(band.bottom, Math.ceil(centerY + outerRadius));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x - centerX) / scale;
      const dy = (y - centerY) / scale;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > VOICE_INDICATOR.radius) continue;

      const glow = 1 - distance / VOICE_INDICATOR.radius;
      const index = (y * WIDTH + x) * 4;
      blendPixel(pixels, index, [197, 157, 111], 0.18 * glow * glow);

      const ringDistance = (distance - ringRadius) / 7;
      const ringAlpha = (speaking ? 0.5 : 0.28) * Math.exp(-ringDistance * ringDistance);
      blendPixel(pixels, index, [241, 199, 145], ringAlpha);

      if (distance <= coreRadius) {
        blendPixel(pixels, index, [255, 237, 211], 0.92 - 0.12 * distance / coreRadius);
        if (distance < coreRadius * 0.32) blendPixel(pixels, index, [255, 251, 239], 0.36);
      }
    }
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
