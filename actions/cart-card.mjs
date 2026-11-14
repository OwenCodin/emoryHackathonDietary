// Track C: the Kroger cart card. It draws what the Kroger API cart has added (product photos, short
// names, line prices, running total) as a 1280x720 RGBA frame that actions/cart.mjs offers through
// getCartFrame. Pure apart from sharp and the injected fetch. downloadPicture, cartCardSvg and
// cardLayout never throw to their caller; renderCartCard can throw and the cart wraps it.
import sharp from 'sharp';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { isKrogerImageUrl } from './kroger.mjs';

const PICTURE_TIMEOUT_MS = 3000;
const PICTURE_MAX_BYTES = 2_000_000;
const RENDER_TIMEOUT_MS = 3000;
export const CARD_MAX_TILES = 6;

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const BACKGROUND = '#0F2430';
const WHITE = '#FFFFFF';
const SOFT = '#CBD5E1';
const LIGHT = '#E2E8F0';
const TILE_FILL = '#17384A';
const PLACEHOLDER_FILL = '#E2E8F0';
const PLACEHOLDER_TEXT = '#64748B';
const TOTAL_COLOR = '#4ADE80';
const FOOTER = 'Nothing is paid. Review and check out yourself.';

// ---- text safety (same behaviour as agent/card.mjs, copied because tracks do not import each other)

function cleanText(value, max) {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const text = raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, Math.max(0, max)).join('');
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function textWidth(s, size, bold = false) {
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

function fitText(s, { max, min, width, bold = false }) {
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

// ---- pictures --------------------------------------------------------------------------------

// Fetches one Kroger product picture. Returns a Buffer, or null for anything wrong. Never rejects.
export async function downloadPicture(url, {
  fetchImpl = fetch,
  timeoutMs = PICTURE_TIMEOUT_MS,
  maxBytes = PICTURE_MAX_BYTES,
} = {}) {
  if (!isKrogerImageUrl(url)) return null;
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    });
    const work = (async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response?.ok) return null;
      const type = response.headers?.get?.('content-type') ?? '';
      if (!type.toLowerCase().startsWith('image/')) return null;
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const body = await response.arrayBuffer();
      if (body.byteLength > maxBytes) return null;
      return Buffer.from(body);
    })();
    work.catch(() => {});
    return (await Promise.race([work, timeout])) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- layout ----------------------------------------------------------------------------------

const GRID_X = 60;
const GRID_Y = 140;
const COLUMNS = 3;
const GAP = 20;
const TILE_W = 373;
const TILE_H = 245;
const PAD = 14;
const PHOTO_H = 120;

// The rectangles for `count` tiles (at most CARD_MAX_TILES), each with its photo box.
export function cardLayout(count) {
  const n = Math.max(0, Math.min(CARD_MAX_TILES, Number.isFinite(count) ? Math.floor(count) : 0));
  const tiles = [];
  // One row of tiles is centred between the header and the footer; two rows fill the space.
  const top = n <= COLUMNS ? GRID_Y + Math.round((TILE_H + GAP) / 2) : GRID_Y;
  for (let i = 0; i < n; i++) {
    const x = GRID_X + (i % COLUMNS) * (TILE_W + GAP);
    const y = top + Math.floor(i / COLUMNS) * (TILE_H + GAP);
    tiles.push({ x, y, w: TILE_W, h: TILE_H, photo: { x: x + PAD, y: y + PAD, w: TILE_W - 2 * PAD, h: PHOTO_H } });
  }
  return tiles;
}

const text = (x, y, size, fill, body, { weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${body}</text>`;

const money = (n) => `$${n.toFixed(2)}`;
const validPrice = (p) => (typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : null);

function normalise(items) {
  return (Array.isArray(items) ? items : [])
    .filter((i) => i && typeof i === 'object')
    .map((i) => ({
      name: cleanText(i.name, 80) || 'Item',
      price: validPrice(i.price),
      quantity: Number.isInteger(i.quantity) && i.quantity > 1 ? i.quantity : 1,
      picture: i.picture ?? null,
    }));
}

function nameLines(name, width) {
  const words = name.split(' ');
  let first = words[0];
  let used = 1;
  while (used < words.length && textWidth(`${first} ${words[used]}`, 24) <= width) {
    first = `${first} ${words[used]}`;
    used += 1;
  }
  if (textWidth(first, 24) > width) return [fitText(first, { max: 24, min: 24, width }).text];
  if (used >= words.length) return [first];
  return [first, fitText(words.slice(used).join(' '), { max: 24, min: 24, width }).text];
}

function tileSvg(tile, item) {
  const inner = tile.w - 2 * PAD;
  const { photo } = tile;
  const lines = nameLines(item.name, inner);
  const price = item.price === null ? '' : `${money(item.price)}${item.quantity > 1 ? ` · x${item.quantity}` : ''}`;
  const parts = [
    `<g data-tile="product">`,
    `<rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" rx="16" fill="${TILE_FILL}"/>`,
    `<rect x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" rx="10" fill="${PLACEHOLDER_FILL}"/>`,
    text(photo.x + photo.w / 2, photo.y + photo.h / 2 + 9, 28, PLACEHOLDER_TEXT, 'No picture', { anchor: 'middle' }),
  ];
  const nameY = photo.y + photo.h + 30;
  lines.forEach((line, i) => parts.push(text(tile.x + PAD, nameY + i * 26, 24, LIGHT, escapeXml(line))));
  if (price) parts.push(text(tile.x + PAD, tile.y + tile.h - 14, 28, WHITE, escapeXml(price), { weight: 700 }));
  parts.push('</g>');
  return parts.join('');
}

// The whole card as SVG text, without photos (renderCartCard composites those over the placeholders).
export function cartCardSvg({ storeName = 'Kroger', items = [], step = '', total } = {}) {
  const list = normalise(items);
  const sum = list.reduce((acc, i) => acc + (i.price ?? 0), 0);
  const shownTotal = typeof total === 'number' && Number.isFinite(total) ? total : sum;
  const store = cleanText(storeName, 30) || 'Kroger';
  const title = fitText(`Your ${store} cart`, { max: 48, min: 30, width: 700, bold: true });
  const stepText = fitText(cleanText(step, 120), { max: 28, min: 20, width: 1160 });
  const overflow = list.length > CARD_MAX_TILES;
  const shown = overflow ? list.slice(0, CARD_MAX_TILES - 1) : list;
  const layout = cardLayout(overflow ? CARD_MAX_TILES : list.length);

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>`,
    text(60, 78, title.size, WHITE, escapeXml(title.text), { weight: 700 }),
    text(1220, 78, 44, shownTotal > 0 || list.length ? TOTAL_COLOR : WHITE, escapeXml(`Total ${money(shownTotal)}`), { weight: 700, anchor: 'end' }),
  ];
  if (stepText.text) out.push(text(60, 122, stepText.size, SOFT, escapeXml(stepText.text)));
  shown.forEach((item, i) => out.push(tileSvg(layout[i], item)));
  if (overflow) {
    const tile = layout[CARD_MAX_TILES - 1];
    out.push(
      `<g data-tile="more"><rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" rx="16" fill="${TILE_FILL}"/>`
      + text(tile.x + tile.w / 2, tile.y + tile.h / 2 + 18, 56, WHITE, escapeXml(`+${list.length - shown.length} more`), { weight: 700, anchor: 'middle' })
      + '</g>',
    );
  }
  out.push(text(WIDTH / 2, 692, 30, SOFT, escapeXml(FOOTER), { anchor: 'middle' }), '</svg>');
  return out.join('');
}

async function preparePhoto(picture, box) {
  if (!picture) return null;
  try {
    return await sharp(picture, { limitInputPixels: 25_000_000 })
      .resize(box.w, box.h, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

// Renders the card to a fresh exact-size RGBA Uint8Array. Throws on failure (the cart catches it).
export async function renderCartCard({ storeName, items, step, total } = {}) {
  const list = normalise(items);
  const svg = cartCardSvg({ storeName, items: list, step, total });
  const overflow = list.length > CARD_MAX_TILES;
  const shown = overflow ? list.slice(0, CARD_MAX_TILES - 1) : list;
  const layout = cardLayout(overflow ? CARD_MAX_TILES : list.length);

  const photos = await Promise.all(shown.map((item, i) => preparePhoto(item.picture, layout[i].photo)));
  const composites = [];
  photos.forEach((input, i) => {
    if (input) composites.push({ input, left: layout[i].photo.x, top: layout[i].photo.y });
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('render timeout')), RENDER_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    let image = sharp(Buffer.from(svg));
    if (composites.length) image = image.composite(composites);
    const work = image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
