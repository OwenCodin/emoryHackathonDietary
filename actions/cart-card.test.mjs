import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { CARD_MAX_TILES, cardLayout, cartCardSvg, downloadPicture, renderCartCard } from './cart-card.mjs';

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
