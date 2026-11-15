import sharp from 'sharp';
import { HEIGHT, SAFE_SCALE, WIDTH, safeTransform } from '../shared/video.mjs';

const FONT = 'Inter, Arial, sans-serif';
const C = Object.freeze({
  background: '#0B1420',
  backgroundDeep: '#101D2A',
  glow: '#153544',
  orbA: '#81E4D1',
  orbB: '#77A8FF',
  orbHighlight: '#DBFFF6',
  orbRing: '#AEE7E3',
  surface: '#142532',
  surfaceEdge: '#29404C',
  text: '#F4F7FA',
  secondary: '#CAD4DD',
  muted: '#AAB8C4',
  track: '#263B47',
  bar: '#73CDBD',
  yes: '#68D6A3',
  caution: '#F0C372',
  no: '#F07C82',
});

export const UI_TOKENS = Object.freeze({
  colors: C,
  spacing: Object.freeze([4, 8, 12, 16, 24, 32, 48]),
  radius: Object.freeze({ card: 28, chip: 14, pill: 24 }),
  type: Object.freeze({ family: FONT, body: 22, title: 30, verdict: 52 }),
  transitionMs: 400,
});

const safeString = value => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}\u{200D}]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

export function cleanText(value, maxLength = 160) {
  return Array.from(safeString(value)).slice(0, Math.max(0, maxLength)).join('');
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const trimToWidth = (value, maxCharacters) => {
  const text = cleanText(value);
  const chars = Array.from(text);
  if (chars.length <= maxCharacters) return text;
  return `${chars.slice(0, Math.max(0, maxCharacters - 1)).join('').trimEnd()}…`;
};

const fontSize = (px, scale) => (px / scale).toFixed(2);
const t = (x, y, size, fill, value, scale, weight = 500, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${fontSize(size, scale)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;

function defs() {
  return `<defs>
    <linearGradient id="backdrop" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101D2A"/><stop offset="1" stop-color="#08111B"/></linearGradient>
    <radialGradient id="stage-glow"><stop stop-color="${C.glow}" stop-opacity=".68"/><stop offset="1" stop-color="${C.background}" stop-opacity="0"/></radialGradient>
    <linearGradient id="orb" x1=".15" y1=".1" x2=".88" y2=".92"><stop stop-color="${C.orbA}"/><stop offset="1" stop-color="${C.orbB}"/></linearGradient>
    <linearGradient id="orb-sheen" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".44"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity=".04"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
    <filter id="panel-shadow" x="-.1" y="-.2" width="1.3" height="1.5"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>`;
}

function statusStrip(state, scale) {
  const labels = {
    idle: 'Ready',
    listening: 'Listening',
    looking: 'Looking',
    thinking: 'Thinking',
    speaking: 'Speaking',
  };
  return `<circle cx="148" cy="110" r="5" fill="#83D9CC"/>
    ${t(166, 117, 18, C.secondary, labels[state] ?? labels.idle, scale, 600)}`;
}

function summaryPanel(event, scale) {
  const meters = Array.isArray(event?.meters) ? event.meters.slice(0, 4) : [];
  let svg = t(144, 463, 30, C.text, 'Today', scale, 650);
  if (!meters.length) {
    svg += t(144, 523, 22, C.secondary, 'Your tracked limits will appear here.', scale, 450);
    return svg;
  }
  const left = 144, top = 490, width = 864, gap = 18, column = (width - gap * (meters.length - 1)) / meters.length;
  meters.forEach((meter, index) => {
    const x = left + index * (column + gap);
    const label = trimToWidth(meter.label, 19);
    const value = `${formatAmount(meter.used)} / ${formatAmount(meter.limit)} ${meter.unit}`;
    const ratio = Math.max(0, Math.min(1, meter.used / meter.limit));
    svg += t(x, top + 23, 18, C.secondary, label, scale, 600);
    svg += t(x, top + 52, 18, C.text, trimToWidth(value, Math.max(14, Math.floor(column / 10))), scale, 550);
    svg += `<rect x="${x}" y="${top + 68}" width="${column}" height="7" rx="4" fill="${C.track}"/>
      <rect x="${x}" y="${top + 68}" width="${(column * ratio).toFixed(1)}" height="7" rx="4" fill="${C.bar}"/>`;
  });
  return svg;
}

function formatAmount(value) {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
}

function verdictIcon(verdict, x, y, scale) {
  const color = ({ yes: C.yes, caution: C.caution, no: C.no })[verdict];
  if (verdict === 'yes') {
    return `<circle cx="${x}" cy="${y}" r="31" fill="${color}"/>
      <path d="M${x - 14} ${y} l10 11 20 -23" fill="none" stroke="${C.background}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (verdict === 'no') {
    return `<circle cx="${x}" cy="${y}" r="31" fill="${color}"/>
      <path d="M${x - 11} ${y - 11} l22 22 M${x + 11} ${y - 11} l-22 22" fill="none" stroke="${C.background}" stroke-width="6" stroke-linecap="round"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="31" fill="none" stroke="${color}" stroke-width="5"/>
    ${t(x, y + 13, 36, color, '!', scale, 800, 'middle')}`;
}

function nutrientChips(nutrients, scale) {
  const rows = nutrients.slice(0, 3);
  if (!rows.length) return '';
  const start = 750, y = 638, gap = 10, width = Math.min(245, 240 / rows.length);
  return rows.map((nutrient, index) => {
    const x = start + index * (width + gap);
    const label = trimToWidth(`${nutrient.label}: ${nutrient.level}`, 25);
    return `<rect x="${x}" y="${y - 23}" width="${width}" height="32" rx="16" fill="#203744" stroke="${C.surfaceEdge}" stroke-width="1"/>
      ${t(x + width / 2, y, 16, C.secondary, label, scale, 550, 'middle')}`;
  }).join('');
}

function verdictPanel(event, scale) {
  const color = ({ yes: C.yes, caution: C.caution, no: C.no })[event.verdict];
  const word = ({ yes: 'YES', caution: 'CAUTION', no: 'NO' })[event.verdict];
  let svg = verdictIcon(event.verdict, 158, 475, scale);
  svg += t(210, 478, 52, color, word, scale, 750);
  svg += t(210, 515, 25, C.text, trimToWidth(event.food, 44), scale, 650);
  svg += t(144, 552, 21, C.secondary, trimToWidth(event.reason, 72), scale, 450);
  if (event.alternative) svg += t(144, 586, 19, C.muted, trimToWidth(`Try instead: ${event.alternative}`, 80), scale, 500);
  svg += nutrientChips(event.nutrients ?? [], scale);
  return svg;
}

function noteGlyph(icon, x, y, scale) {
  if (icon === 'alert') {
    return `<path d="M${x} ${y - 26} L${x + 26} ${y + 22} H${x - 26} Z" fill="none" stroke="${C.orbA}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M${x} ${y - 10} v15 M${x} ${y + 14} v1" stroke="${C.orbA}" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (icon === 'check') {
    return `<circle cx="${x}" cy="${y}" r="24" fill="none" stroke="${C.orbA}" stroke-width="4"/>
      <path d="M${x - 11} ${y} l8 9 16 -18" fill="none" stroke="${C.orbA}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="23" fill="none" stroke="${C.orbA}" stroke-width="4"/>
    ${t(x, y + 10, 28, C.orbA, 'i', scale, 700, 'middle')}`;
}

function notePanel(event, scale) {
  const icon = ['alert', 'check'].includes(event.icon) ? event.icon : 'info';
  return `${noteGlyph(icon, 158, 500, scale)}
    ${t(210, 484, 30, C.text, trimToWidth(event.heading, 46), scale, 650)}
    ${t(210, 530, 22, C.secondary, trimToWidth(event.body, 64), scale, 450)}`;
}

function cartPanel(event, scale) {
  const status = ({ draft: 'Draft', confirming: 'Awaiting confirmation', ordered: 'Ordered' })[event.status];
  const visible = event.items.slice(0, 5);
  const itemText = visible.map(item => `${item.name}${item.qty ? ` · ${item.qty}` : ''}`);
  const remaining = Math.max(0, event.items.length - visible.length);
  if (remaining > 0) itemText.push(`+${remaining} more`);
  let svg = t(144, 463, 30, C.text, 'Shopping list', scale, 650);
  const listX = 144, startY = 496, gap = 28;
  itemText.forEach((label, index) => {
    const x = listX + (index % 2) * 425;
    const y = startY + Math.floor(index / 2) * gap;
    svg += `<circle cx="${x + 4}" cy="${y - 6}" r="3" fill="${C.orbA}"/>`;
    svg += t(x + 16, y, 18, C.secondary, trimToWidth(label, 42), scale, 450);
  });
  const total = event.estimatedTotal ? ` · Est. ${trimToWidth(event.estimatedTotal, 24)}` : '';
  svg += t(144, 633, 18, C.text, `${status}${total}`, scale, 600);
  return svg;
}

function panelContent(event, scale) {
  const panel = event?.type === 'verdict'
    ? verdictPanel(event, scale)
    : event?.type === 'note'
      ? notePanel(event, scale)
      : event?.type === 'cart'
        ? cartPanel(event, scale)
        : summaryPanel(event, scale);
  return panel;
}

function panelChrome() {
  return `<rect x="110" y="415" width="930" height="245" rx="28" fill="#030911" opacity=".34" filter="url(#panel-shadow)"/>
    <rect x="110" y="415" width="930" height="245" rx="28" fill="${C.surface}" stroke="${C.surfaceEdge}" stroke-width="2"/>
    <rect x="112" y="417" width="926" height="241" rx="26" fill="#FFFFFF" opacity=".018"/>`;
}

export function panelSvg(event = null, { scale = SAFE_SCALE } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${defs()}
    <g transform="${safeTransform(scale)}">${panelChrome()}${panelContent(event, scale)}</g>
    </svg>`;
}

export function sceneSvg({ state = 'idle', scale = SAFE_SCALE } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${defs()}
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#backdrop)"/>
    <g transform="${safeTransform(scale)}">
      <ellipse cx="640" cy="254" rx="270" ry="215" fill="url(#stage-glow)"/>
      ${statusStrip(state, scale)}
    </g>
    </svg>`;
}

export async function renderSvg(svg, { timeoutMs = 3000 } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('render timeout')), timeoutMs);
  });
  try {
    const work = sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    work.catch(() => {});
    const { data, info } = await Promise.race([work, timeout]);
    if (info.width !== WIDTH || info.height !== HEIGHT || data.length !== WIDTH * HEIGHT * 4) {
      throw new Error('render size');
    }
    return new Uint8Array(data);
  } finally {
    clearTimeout(timer);
  }
}
