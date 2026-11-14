// The RenaLine screens the caller sees: an idle brand screen and a verdict card, both plain SVG
// rendered by sharp. The builders are pure; only renderSvg touches sharp. Every drawn string goes
// cleanText -> fitText -> escapeXml, in that order, and the builders read only the fields of the
// display object listed below (never a name, phone number or patient id).
import sharp from 'sharp';
import { HEIGHT, SAFE_SCALE, WIDTH, safeArea, safeTransform } from '../shared/video.mjs';

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const BACKGROUND = '#0F2430';
const WHITE = '#FFFFFF';
const SOFT = '#CBD5E1';
const LIGHT = '#E2E8F0';
const MINT = '#62E5C1';
const PANEL = '#152F3A';

export const VERDICTS = {
  ok: { word: 'YES', detail: 'Fits your limits', color: '#63E6A7', icon: 'ok' },
  limit: { word: 'MAYBE', detail: 'Small portion', color: '#F6C768', icon: 'limit' },
  avoid: { word: 'NO', detail: 'Outside your limits', color: '#FF7C82', icon: 'avoid' },
  unknown: { word: 'CHECK', detail: "I couldn't tell", color: '#CBD5E1', icon: 'unknown' },
};
const verdictOf = key => (Object.hasOwn(VERDICTS, key) ? VERDICTS[key] : VERDICTS.unknown);

// The voice wave is painted per frame along the lower edge of the safe area.
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
    <linearGradient id="scene" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#102B38"/><stop offset="1" stop-color="#081820"/></linearGradient>
    <radialGradient id="halo"><stop stop-color="#275B61" stop-opacity=".85"/><stop offset="1" stop-color="#0F2430" stop-opacity="0"/></radialGradient>
    <linearGradient id="skin" x1=".2" y1="0" x2=".8" y2="1"><stop stop-color="#F2C9AD"/><stop offset=".55" stop-color="#DFA98B"/><stop offset="1" stop-color="#BD806E"/></linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#342B31"/><stop offset=".55" stop-color="#211F29"/><stop offset="1" stop-color="#131922"/></linearGradient>
    <linearGradient id="jacket" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#E6F0E9"/><stop offset="1" stop-color="#AFC9C0"/></linearGradient>
    <linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#48A99A"/><stop offset="1" stop-color="#286B6B"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".025"/></linearGradient>
    <filter id="soft-shadow" x="-.3" y="-.3" width="1.6" height="1.8"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>`;
}

function avatar() {
  return `<g aria-label="RenaLine AI nutrition companion">
    <ellipse cx="382" cy="620" rx="235" ry="25" fill="#02090D" opacity=".38" filter="url(#soft-shadow)"/>
    <circle cx="382" cy="330" r="290" fill="url(#halo)"/>
    <circle cx="382" cy="330" r="230" fill="none" stroke="#B2F1DF" stroke-opacity=".14" stroke-width="2"/>
    <path d="M142 672 C151 554 218 482 303 464 L382 483 L461 464 C548 482 614 554 623 672Z" fill="url(#jacket)"/>
    <path d="M287 468 L382 546 L477 468 L447 672 L317 672Z" fill="url(#shirt)"/>
    <path d="M337 415 L337 488 Q382 527 427 488 L427 415Z" fill="url(#skin)"/>
    <path d="M265 207 C249 116 315 70 390 74 C479 77 522 140 499 250 L490 365 L271 354Z" fill="url(#hair)"/>
    <ellipse cx="264" cy="296" rx="22" ry="38" fill="#CE9479"/>
    <ellipse cx="500" cy="296" rx="22" ry="38" fill="#C88A73"/>
    <path d="M276 199 C279 130 322 101 383 99 C448 98 483 133 488 207 L472 339 C463 406 426 448 382 450 C338 448 300 406 291 339Z" fill="url(#skin)"/>
    <path d="M273 232 C267 149 310 87 382 84 C453 81 496 127 494 220 C470 197 457 168 449 143 C411 176 360 189 304 184 L294 258Z" fill="url(#hair)"/>
    <path d="M277 192 C252 245 270 334 292 366 C286 305 298 269 303 235Z" fill="url(#hair)"/>
    <path d="M486 181 C513 242 500 331 473 367 C481 303 468 267 461 229Z" fill="url(#hair)"/>
    <path d="M308 270 Q337 251 361 267" fill="none" stroke="#68473D" stroke-width="8" stroke-linecap="round"/>
    <path d="M404 267 Q432 251 457 270" fill="none" stroke="#68473D" stroke-width="8" stroke-linecap="round"/>
    <path d="M310 296 Q337 278 362 296 Q338 315 310 296Z" fill="#FFF9F2"/>
    <path d="M403 296 Q429 278 455 296 Q430 315 403 296Z" fill="#FFF9F2"/>
    <ellipse cx="338" cy="296" rx="7" ry="10" fill="#557C75"/><ellipse cx="430" cy="296" rx="7" ry="10" fill="#557C75"/>
    <circle cx="340" cy="293" r="3" fill="#17242A"/><circle cx="432" cy="293" r="3" fill="#17242A"/>
    <circle cx="342" cy="291" r="2" fill="#FFFFFF"/><circle cx="434" cy="291" r="2" fill="#FFFFFF"/>
    <path d="M300 294 Q336 266 369 292" fill="none" stroke="#42353A" stroke-width="4" opacity=".7"/>
    <path d="M397 292 Q431 265 465 294" fill="none" stroke="#42353A" stroke-width="4" opacity=".7"/>
    <path d="M384 301 C379 326 371 347 376 355 Q384 362 393 354" fill="none" stroke="#A66E60" stroke-width="5" stroke-linecap="round"/>
    <path d="M350 383 Q382 397 414 382" fill="none" stroke="#9D5960" stroke-width="4" stroke-linecap="round"/>
    <path d="M345 390 Q382 407 419 390" fill="none" stroke="#F0B7A1" stroke-width="3" opacity=".7"/>
    <path d="M301 313 Q312 363 334 381 M463 313 Q452 363 430 381" fill="none" stroke="#F7D8C1" stroke-opacity=".22" stroke-width="5"/>
    <path d="M322 476 L382 526 L442 476" fill="none" stroke="#F6FAF4" stroke-width="8" opacity=".8"/>
    <circle cx="382" cy="545" r="7" fill="#D1A76E"/>
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
    avatar(),
    text(710, 186, 24, MINT, 'YOUR RENAL DIETITIAN', { weight: 800 }),
    panel(692, 210, 510, 264),
    text(730, 278, 58, WHITE, 'RenaLine', { weight: 800 }),
    text(730, 326, 30, LIGHT, 'A calm companion for food choices'),
    `<circle cx="747" cy="395" r="9" fill="${MINT}"/>`,
    text(768, 404, 25, SOFT, 'Here with you, live'),
    text(730, 447, 22, SOFT, "Follows your care team's limits"),
    text(382, 624, 24, LIGHT, 'RenaLine', { weight: 700, anchor: 'middle' }),
    close,
  ].join('');
}

export function cardSvg(display, { scale = SAFE_SCALE } = {}) {
  const items = Array.isArray(display?.items) ? display.items.filter(i => i && typeof i === 'object') : [];
  const unjudged = display?.unjudged === true;
  if (items.length === 0 && !unjudged) return brandSvg({ scale });
  const more = Number.isInteger(display?.more) && display.more > 0 ? display.more : 0;
  const parts = [sceneOpen(scale), avatar(), text(710, 142, 23, MINT, 'FOOD CHECK', { weight: 800 }), panel(692, 165, 510, 330)];
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

// ---- voice wave -------------------------------------------------------------------------------

// The wave band in frame pixels, after the safe-area mapping.
export function waveBand(scale = SAFE_SCALE) {
  const a = safeArea(scale);
  return {
    top: Math.floor(a.y + WAVE.top * scale),
    bottom: Math.ceil(a.y + WAVE.bottom * scale),
    left: Math.floor(a.x + WAVE_LEFT * scale),
    right: Math.ceil(a.x + (WAVE_LEFT + WAVE_SPAN) * scale),
  };
}

function paintEllipse(pixels, cx, cy, rx, ry, color, scale) {
  const a = safeArea(scale);
  const x0 = Math.max(0, Math.floor(a.x + (cx - rx) * scale));
  const x1 = Math.min(WIDTH, Math.ceil(a.x + (cx + rx) * scale));
  const y0 = Math.max(0, Math.floor(a.y + (cy - ry) * scale));
  const y1 = Math.min(HEIGHT, Math.ceil(a.y + (cy + ry) * scale));
  for (let y = y0; y < y1; y++) {
    const designY = (y - a.y) / scale;
    for (let x = x0; x < x1; x++) {
      const designX = (x - a.x) / scale;
      if (((designX - cx) / rx) ** 2 + ((designY - cy) / ry) ** 2 > 1) continue;
      const i = (y * WIDTH + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }
}

// The mouth follows the same speaking state as the audio and voice wave.
export function paintMouth(pixels, tick, speaking, scale = SAFE_SCALE) {
  const openAmount = speaking ? 2 + 8 * Math.abs(Math.sin((Number.isFinite(tick) ? tick : 0) * 0.8)) : 1.2;
  paintEllipse(pixels, 382, 386, 27, openAmount + 3, [157, 83, 87], scale);
  paintEllipse(pixels, 382, 385, 22, openAmount, [69, 37, 45], scale);
  if (speaking && openAmount > 6) {
    paintEllipse(pixels, 382, 389 + openAmount * 0.25, 9, 2, [205, 116, 117], scale);
  }
}

// x0..y1 are in design space; they are mapped to frame space before rounding.
function fillRect(pixels, x0, y0, x1, y1, [r, g, b], scale) {
  const a = safeArea(scale);
  const band = waveBand(scale);
  const xa = Math.max(0, Math.min(WIDTH, Math.round(a.x + x0 * scale)));
  const xb = Math.max(0, Math.min(WIDTH, Math.round(a.x + x1 * scale)));
  const ya = Math.max(band.top, Math.min(band.bottom, Math.round(a.y + y0 * scale)));
  const yb = Math.max(band.top, Math.min(band.bottom, Math.round(a.y + y1 * scale)));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * WIDTH + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
}

// Mutates the RGBA buffer in place, only inside the wave band.
export function paintWave(pixels, tick, speaking, scale = SAFE_SCALE) {
  const t = Number.isFinite(tick) ? tick : 0;
  if (speaking) {
    for (let i = 0; i < WAVE.bars; i++) {
      const level = Math.abs(Math.sin(t * 0.55 + i * 0.7)) * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.23 + i * 1.3)));
      const h = 10 + level * 66;
      const x = WAVE_LEFT + i * (WAVE.barWidth + WAVE.gap);
      fillRect(pixels, x, WAVE.center - h / 2, x + WAVE.barWidth, WAVE.center + h / 2, WAVE.color, scale);
    }
  } else {
    fillRect(pixels, WAVE_LEFT, WAVE.center - WAVE.flat / 2, WAVE_LEFT + WAVE_SPAN, WAVE.center + WAVE.flat / 2, WAVE.color, scale);
    const dotX = WAVE_LEFT + ((Math.abs(Math.floor(t)) * 9) % (WAVE_SPAN - 14));
    fillRect(pixels, dotX, WAVE.center - 7, dotX + 14, WAVE.center + 7, [255, 255, 255], scale);
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
