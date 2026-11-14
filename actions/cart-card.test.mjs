import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { HEIGHT, SAFE_SCALE_DEFAULT, WIDTH, safeArea } from '../shared/video.mjs';
import { CARD_MAX_TILES, PREVIEW_FOOTER, PREVIEW_TITLE, cardLayout, cartCardSvg, downloadPicture, renderCartCard } from './cart-card.mjs';

const GOOD = 'https://www.kroger.com/product/images/large/front/0001';
const SIZE = WIDTH * HEIGHT * 4;

function fakeFetch(make) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return make(url, init);
  };
  return { fetchImpl, calls };
}

const response = ({ ok = true, status = 200, headers = {}, body = Buffer.from('x') } = {}) => ({
  ok,
  status,
  headers: new Headers(headers),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

const png = (w, h, color = '#336699') =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

const item = (name, price = 3.5, quantity = 1, picture = null) => ({ name, price, quantity, picture });

test('downloadPicture refuses disallowed URLs without fetching', async () => {
  const { fetchImpl, calls } = fakeFetch(() => response());
  for (const url of [
    'http://www.kroger.com/product/images/x',
    'https://evil.example/product/images/x',
    'https://www.kroger.com@evil.example/product/images/x',
    'https://www.kroger.com/cart',
    null,
  ]) {
    assert.equal(await downloadPicture(url, { fetchImpl }), null);
  }
  assert.equal(calls.length, 0);
});

test('downloadPicture fetches with redirect error and no auth header, returns a Buffer', async () => {
  const body = await png(4, 4);
  const { fetchImpl, calls } = fakeFetch(() => response({ headers: { 'content-type': 'image/png' }, body }));
  const out = await downloadPicture(GOOD, { fetchImpl });
  assert.ok(Buffer.isBuffer(out));
  assert.equal(out.length, body.length);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers, undefined);
});

test('downloadPicture returns null for bad status, type, size and failures', async () => {
  const run = async (make, opts = {}) => downloadPicture(GOOD, { fetchImpl: async () => make(), ...opts });
  assert.equal(await run(() => response({ ok: false, status: 404, headers: { 'content-type': 'image/png' } })), null);
  assert.equal(await run(() => response({ headers: { 'content-type': 'text/html' } })), null);
  assert.equal(await run(() => response({})), null);
  assert.equal(await run(() => response({ headers: { 'content-type': 'image/png', 'content-length': '2000001' } })), null);
  assert.equal(await run(() => response({ headers: { 'content-type': 'image/png' }, body: Buffer.alloc(2_000_001) })), null);
  assert.equal(await run(() => { throw new Error('boom'); }), null);
  assert.equal(await run(() => Promise.reject(new Error('boom'))), null);
});

test('downloadPicture resolves null when the fetch never settles', async () => {
  const started = Date.now();
  const out = await downloadPicture(GOOD, { fetchImpl: () => new Promise(() => {}), timeoutMs: 50 });
  assert.equal(out, null);
  assert.ok(Date.now() - started < 1000);
});

function assertExact(frame) {
  assert.ok(frame instanceof Uint8Array);
  assert.equal(frame.byteLength, SIZE);
  assert.equal(frame.byteOffset, 0);
  assert.equal(frame.byteLength, frame.buffer.byteLength);
}

test('renderCartCard gives an exact-size frame for 1, 3 and 7 items', async () => {
  const pic = await png(40, 40);
  for (const n of [1, 3, 7]) {
    const items = Array.from({ length: n }, (_, i) => item(`Product number ${i + 1}`, 2 + i, 1 + (i % 2), pic));
    assertExact(await renderCartCard({ storeName: 'Kroger', items, step: 'Kroger cart updated' }));
  }
});

test('renderCartCard falls back to a placeholder for no, bad and oversized pictures', async () => {
  const huge = await png(3000, 3000);
  const frame = await renderCartCard({
    items: [
      item('No picture', 1, 1, null),
      item('Garbage bytes', 2, 1, Buffer.from('this is not an image at all')),
      item('Huge picture', 3, 1, huge),
    ],
  });
  assertExact(frame);
});

test('cartCardSvg escapes product text', async () => {
  const name = 'Kroger® "Big" <Deal> & more';
  const svg = cartCardSvg({ items: [item(name, 4)] });
  assert.ok(svg.includes('&lt;Deal&gt;'));
  assert.ok(svg.includes('&amp;'));
  assert.ok(svg.includes('&quot;'));
  assert.ok(!svg.includes('<Deal>'));
  assertExact(await renderCartCard({ items: [item(name, 4)] }));
});

test('cartCardSvg draws five tiles and a +2 more tile for seven items, total covers all', () => {
  const items = Array.from({ length: 7 }, (_, i) => item(`Item ${i + 1}`, 1.5));
  const svg = cartCardSvg({ items });
  assert.equal(CARD_MAX_TILES, 6);
  assert.equal(cardLayout(7).length, 6);
  assert.equal((svg.match(/data-tile="product"/g) ?? []).length, 5);
  assert.ok(svg.includes('+2 more'));
  assert.ok(svg.includes('Total $10.50'));
});

test('cartCardSvg shows quantity, footer, and never NaN', () => {
  const svg = cartCardSvg({
    items: [item('Rice', 7.18, 2), { name: 'Odd', price: undefined, quantity: 1 }, { name: 'Odd2', price: NaN, quantity: 1 }],
    step: 'Kroger cart updated',
  });
  assert.ok(svg.includes('$7.18 · x2'));
  assert.ok(svg.includes('Nothing is paid. Review and check out yourself.'));
  assert.ok(svg.includes('Your Kroger cart'));
  assert.ok(!svg.includes('NaN'));
});

test('cartCardSvg uses the passed total when finite', () => {
  assert.ok(cartCardSvg({ items: [item('A', 1)], total: 9.99 }).includes('Total $9.99'));
});

// ---- safe area -------------------------------------------------------------------------------

const MARGIN_X = Math.floor(0.09 * WIDTH);
const MARGIN_Y = Math.floor(0.09 * HEIGHT);
const BG = [15, 36, 48, 255];
const inMargin = (x, y) => x < MARGIN_X || x >= WIDTH - MARGIN_X || y < MARGIN_Y || y >= HEIGHT - MARGIN_Y;
const px = (frame, x, y) => Array.from(frame.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4));
function marginIsOnly(frame, rgba) {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (inMargin(x, y) && px(frame, x, y).some((v, k) => v !== rgba[k])) return false;
    }
  }
  return true;
}
function insideHasContent(frame) {
  for (let y = MARGIN_Y; y < HEIGHT - MARGIN_Y; y++) {
    for (let x = MARGIN_X; x < WIDTH - MARGIN_X; x++) {
      if (px(frame, x, y).slice(0, 3).some((v, k) => v !== BG[k])) return true;
    }
  }
  return false;
}

test('cart card keeps the outer 9% background-only at the default scale', async () => {
  const pic = await png(40, 40);
  for (const n of [1, 3, 7]) {
    const items = Array.from({ length: n }, (_, i) => item(`Kroger Honeycrisp Apples 4 Pack Tray ${i + 1}`, 2 + i, 1 + (i % 2), pic));
    const frame = await renderCartCard({ storeName: 'Kroger', items, step: 'Kroger cart updated', scale: SAFE_SCALE_DEFAULT });
    assertExact(frame);
    assert.ok(marginIsOnly(frame, BG), `margin, ${n} items`);
    assert.ok(insideHasContent(frame), `content, ${n} items`);
  }
});

test('cart card photos land at the scaled positions', async () => {
  const pic = await png(200, 120, '#336699');
  const frame = await renderCartCard({ items: [item('Rice', 1.89, 1, pic)], scale: SAFE_SCALE_DEFAULT });
  const a = safeArea(SAFE_SCALE_DEFAULT);
  const { photo } = cardLayout(1)[0];
  const cx = Math.round(a.x + (photo.x + photo.w / 2) * SAFE_SCALE_DEFAULT);
  const cy = Math.round(a.y + (photo.y + photo.h / 2) * SAFE_SCALE_DEFAULT);
  assert.deepEqual(px(frame, cx, cy), [51, 102, 153, 255]);
});

test('cart card at scale 1 is the old full-frame layout', async () => {
  const svg = cartCardSvg({ items: [item('Rice', 1.89)], scale: 1 });
  assert.ok(svg.includes('scale(1)'));
  const frame = await renderCartCard({ items: [item('A', 1), item('B', 2), item('C', 3)], scale: 1 });
  assertExact(frame);
  assert.ok(!marginIsOnly(frame, BG));
});

test('cartCardSvg keeps today\'s title, total and footer without the new options', () => {
  const svg = cartCardSvg({ items: [{ name: 'Butter', price: 3, quantity: 1 }] });
  assert.ok(svg.includes('Your Kroger cart'));
  assert.ok(svg.includes('Total $3.00'));
  assert.ok(svg.includes('Nothing is paid. Review and check out yourself.'));
});

test('cartCardSvg and renderCartCard take a custom title, footer and total label', async () => {
  const opts = { items: [{ name: 'Bread', price: 2, quantity: 1 }], title: PREVIEW_TITLE, footer: PREVIEW_FOOTER, totalLabel: 'About' };
  const svg = cartCardSvg(opts);
  assert.ok(svg.includes(PREVIEW_TITLE));
  assert.ok(svg.includes(PREVIEW_FOOTER));
  assert.ok(svg.includes('About $2.00'));
  assert.ok(!svg.includes('Your Kroger cart'));
  assert.ok(!svg.includes('Nothing is paid. Review and check out yourself.'));
  assert.ok(!svg.includes('Total $'));
  assert.equal((await renderCartCard(opts)).byteLength, SIZE);
});
