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
// The mark sits in the left column; the card takes the rest of the width so its text reads on a phone.
export const VOICE_INDICATOR = { top: 242, bottom: 478, center: 360, x: 270, radius: 118, coreRadius: 20 };
const MARK = { x: VOICE_INDICATOR.x, y: VOICE_INDICATOR.center };
// The card: one box for every screen, so nothing is ever drawn past it.
const CARD = { x: 500, y: 120, width: 730, height: 480, pad: 40 };
const INNER = { x: CARD.x + CARD.pad, width: CARD.width - 2 * CARD.pad };

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
  // The scene light fades to nothing at the edges of the safe area, so no box shows inside the frame.
  return `<defs>
    <radialGradient id="scene" cx=".5" cy=".45" r=".5"><stop stop-color="#2F5049" stop-opacity=".6"/><stop offset="1" stop-color="${BACKGROUND}" stop-opacity="0"/></radialGradient>
    <radialGradient id="halo"><stop stop-color="#8C704B" stop-opacity=".56"/><stop offset="1" stop-color="#142827" stop-opacity="0"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".13"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".025"/></linearGradient>
    <filter id="soft-shadow" x="-.3" y="-.3" width="1.6" height="1.8"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>`;
}

// The mark and, under it, the name of who is talking: the left column always says what this is.
function companionHalo({ caption = true } = {}) {
  const { x, y } = MARK;
  return `<g aria-label="RenaLine voice companion">
    <circle cx="${x}" cy="${y}" r="258" fill="url(#halo)"/>
    <circle cx="${x}" cy="${y}" r="198" fill="none" stroke="#BFD2BB" stroke-opacity=".1" stroke-width="2"/>
    <circle cx="${x}" cy="${y}" r="150" fill="none" stroke="#D8BC91" stroke-opacity=".2" stroke-width="2"/>
    <circle cx="${x}" cy="${y}" r="104" fill="#172F30" fill-opacity=".72"/>
    <circle cx="${x}" cy="${y}" r="104" fill="none" stroke="#C9D7C2" stroke-opacity=".32" stroke-width="2"/>
    <circle cx="${x}" cy="${y}" r="4" fill="#E8D4B5" fill-opacity=".75"/>
  </g>` + (caption
    ? text(x, 598, 34, WHITE, 'RenaLine', { weight: 800, anchor: 'middle' }) + text(x, 636, 22, SOFT, 'Your renal dietitian', { anchor: 'middle' })
    : '');
}

function sceneOpen(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${sceneDefs()}<rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/><g transform="${safeTransform(scale)}"><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scene)"/>`;
}

function panel(x, y, width, height) {
  return `<rect x="${x + 8}" y="${y + 12}" width="${width}" height="${height}" rx="30" fill="#02090D" opacity=".3" filter="url(#soft-shadow)"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="${PANEL}" stroke="#B6E9DA" stroke-opacity=".18" stroke-width="2"/><rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="27" fill="url(#glass)"/>`;
}

// Icon, a gap, then the word: the pill is as wide as what it holds, so the icon never touches the word.
function statusPill(verdict, x, y, compact = false) {
  const v = verdictOf(verdict);
  const label = v.word;
  const font = compact ? 28 : 40;
  const h = compact ? 52 : 68;
  const size = compact ? 28 : 36;
  const padL = compact ? 14 : 18, gap = compact ? 12 : 14, padR = compact ? 20 : 26;
  const width = Math.ceil(padL + size + gap + textWidth(label, font, true) + padR);
  return {
    width,
    height: h,
    svg: `<rect x="${x}" y="${y}" width="${width}" height="${h}" rx="${h / 2}" fill="${v.color}" fill-opacity=".14" stroke="${v.color}" stroke-opacity=".7" stroke-width="2"/>`
      + icon(v.icon, v.color, x + padL, y + (h - size) / 2, size, `icon-${v.icon}`)
      + text(x + padL + size + gap, y + h / 2 + font * 0.36, font, v.color, escapeXml(label), { weight: 800 }),
  };
}

function onlineBadge(x, y) {
  const label = 'FOUND ONLINE';
  const width = 196, height = 40;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#243E49" stroke="#83B9C1" stroke-opacity=".55" stroke-width="1"/>`
    + text(x + width / 2, y + 28, 21, LIGHT, label, { weight: 700, anchor: 'middle' });
}

// Up to three nutrient boxes across the given width; returns the SVG and the height it used.
function nutrientCards(item, x, y, width) {
  const details = detailParts(item);
  const nutrients = details.nutrients.slice(0, 3);
  const portion = details.portion ? fitText(details.portion, { max: 28, min: 20, width }) : null;
  if (!nutrients.length) {
    return portion ? { svg: text(x, y + 30, portion.size, LIGHT, escapeXml(portion.text)), height: 40 } : { svg: '', height: 0 };
  }
  const gap = 14, boxH = 100;
  const each = (width - gap * 2) / 3;
  const boxes = nutrients.map((value, i) => {
    const split = value.match(/^(Sodium|Potassium|Phosphorus)\s+(.+)$/);
    if (!split) return '';
    const xx = x + i * (each + gap);
    const amount = fitText(split[2], { max: 36, min: 24, width: each - 32, bold: true });
    return `<rect x="${xx}" y="${y}" width="${each}" height="${boxH}" rx="16" fill="#0C2029" stroke="#C1E5DD" stroke-opacity=".13"/>`
      + text(xx + 16, y + 34, 19, SOFT, split[1].toUpperCase(), { weight: 700 })
      + text(xx + 16, y + 78, amount.size, WHITE, escapeXml(amount.text), { weight: 700 });
  }).join('');
  return {
    svg: boxes + (portion ? text(x, y + boxH + 42, portion.size, LIGHT, escapeXml(portion.text)) : ''),
    height: boxH + (portion ? 54 : 0),
  };
}

// A food name on one line when it fits, otherwise on two, the second cut with an ellipsis. Returns lines and size.
function nameLines(value, { max, min, width }) {
  const one = fitText(value, { max, min: Math.max(min, 44), width, bold: true });
  if (!one.text.endsWith('…') || !value.includes(' ')) return { lines: [fitText(value, { max, min, width, bold: true }).text], size: one.text.endsWith('…') ? min : one.size };
  const words = value.split(' ');
  let first = words[0], i = 1;
  while (i < words.length && textWidth(`${first} ${words[i]}`, min, true) <= width) first += ` ${words[i++]}`;
  const rest = words.slice(i).join(' ');
  return { lines: rest ? [first, fitText(rest, { max: min, min, width, bold: true }).text] : [first], size: min };
}

const label = body => text(CARD.x + 10, CARD.y - 22, 26, MINT, body, { weight: 800 });

export function brandSvg({ scale = SAFE_SCALE } = {}) {
  const tagline = fitText('A calm companion for food choices', { max: 38, min: 26, width: INNER.width });
  const y = CARD.y + 50;
  return [
    sceneOpen(scale),
    companionHalo({ caption: false }), // the card already carries the name
    label('YOUR RENAL DIETITIAN'),
    panel(CARD.x, y, CARD.width, 380),
    text(INNER.x, y + 124, 96, WHITE, 'RenaLine', { weight: 800 }),
    text(INNER.x, y + 186, tagline.size, LIGHT, tagline.text),
    `<circle cx="${INNER.x + 12}" cy="${y + 262}" r="11" fill="${MINT}"/>`,
    text(INNER.x + 38, y + 273, 32, WHITE, 'Here with you, live'),
    text(INNER.x, y + 328, 27, SOFT, escapeXml("Follows your care team's limits")),
    close,
  ].join('');
}

export function cardSvg(display, { scale = SAFE_SCALE } = {}) {
  const items = Array.isArray(display?.items) ? display.items.filter(i => i && typeof i === 'object') : [];
  const unjudged = display?.unjudged === true;
  if (items.length === 0 && !unjudged) return brandSvg({ scale });
  const more = Number.isInteger(display?.more) && display.more > 0 ? display.more : 0;
  const parts = [sceneOpen(scale), companionHalo(), label('FOOD CHECK'), panel(CARD.x, CARD.y, CARD.width, CARD.height)];
  const online = display?.online === true;
  if (online) parts.push(onlineBadge(CARD.x + CARD.width - 196 - 28, CARD.y + 28));
  const top = CARD.y, x = INNER.x, width = INNER.width;

  if (unjudged) {
    const seen = Number.isInteger(display?.seen) && display.seen > 0 ? display.seen : Math.max(1, items.length);
    const one = seen === 1;
    const names = items.slice(0, 3).map(i => cleanText(i.food, 50)).filter(Boolean);
    // The block is centred in the card whatever the number of names.
    const y = top + (CARD.height - (120 + names.length * 58)) / 2;
    parts.push(text(x, y + 50, 50, WHITE, `I can see ${one ? 'one food' : `${seen} foods`}`, { weight: 700 }));
    parts.push(text(x, y + 104, 32, SOFT, escapeXml(`but I can't judge ${one ? 'it' : 'them'} right now`)));
    names.forEach((name, i) => {
      const f = fitText(capitalise(name), { max: 32, min: 24, width: width - 34 });
      parts.push(`<circle cx="${x + 10}" cy="${y + 160 + i * 58}" r="7" fill="#AABCC1"/>`);
      parts.push(text(x + 34, y + 171 + i * 58, f.size, LIGHT, escapeXml(f.text)));
    });
  } else if (items.length === 1) {
    const item = items[0];
    const v = verdictOf(item.verdict);
    const status = statusPill(item.verdict, x, 0);
    const facts = nutrientCards(item, x, 0, width);
    // Without numbers the name is larger and the block is centred, so the card never looks half empty.
    const big = facts.height === 0;
    const name = nameLines(foodName(item.food), { max: big ? 96 : 68, min: 38, width });
    const lineH = Math.round(name.size * 1.16);
    const nameH = 22 + lineH * name.lines.length, detailH = big ? 58 : 48, detailSize = big ? 38 : 30;
    const block = status.height + nameH + detailH + (facts.height ? 24 + facts.height : 0);
    const y = top + Math.max(online ? 84 : 30, (CARD.height - block) / 2);
    parts.push(statusPill(item.verdict, x, y).svg);
    name.lines.forEach((line, n) => parts.push(text(x, y + status.height + 22 + lineH * (n + 1) - Math.round(name.size * 0.24), name.size, WHITE, escapeXml(line), { weight: 700 })));
    parts.push(text(x, y + status.height + nameH + detailH - 14, detailSize, SOFT, v.detail));
    if (facts.height) parts.push(nutrientCards(item, x, y + status.height + nameH + detailH + 24, width).svg);
  } else {
    const rows = items.slice(0, 3);
    const left = Math.max(0, items.length - 3) + more;
    parts.push(text(x, top + 66, 36, WHITE, 'At a glance', { weight: 700 }));
    const rowH = 96, gap = 14, first = top + 96;
    rows.forEach((r, n) => {
      const y = first + n * (rowH + gap);
      parts.push(`<rect x="${CARD.x + 24}" y="${y}" width="${CARD.width - 48}" height="${rowH}" rx="18" fill="#0C2029" stroke="#C1E5DD" stroke-opacity=".12"/>`);
      const status = statusPill(r.verdict, CARD.x + 44, y + (rowH - 52) / 2, true);
      parts.push(status.svg);
      const nameX = CARD.x + 44 + status.width + 22;
      const nameW = CARD.x + CARD.width - 44 - nameX;
      const f = fitText(foodName(r.food), { max: 36, min: 24, width: nameW, bold: true });
      const nPart = detailParts(r).nutrients[0];
      parts.push(text(nameX, y + (nPart ? 46 : 60), f.size, WHITE, escapeXml(f.text), { weight: 700 }));
      if (nPart) parts.push(text(nameX, y + 76, 21, SOFT, escapeXml(nPart)));
    });
    if (left > 0) parts.push(text(x, first + rows.length * (rowH + gap) + 26, 26, SOFT, escapeXml(`+${left} more`)));
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
