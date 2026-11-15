import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, SAFE_SCALE_DEFAULT, WIDTH } from '../shared/video.mjs';
import { createCompanionFrames, drawCompanion, renderCompanionBase } from './companion.mjs';
import { createVideoPicker, pickFrame } from './video.mjs';

const N = 64;
const good = () => new Uint8Array(N);
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test('pickFrame accepts a correct Uint8Array and a Buffer without drawing', () => {
  let drew = 0;
  const draw = () => { drew++; return new Uint8Array(N); };
  const f = good();
  assert.deepEqual(pickFrame(f, draw, N), { source: 'cart', pixels: f, rejected: false });
  const b = Buffer.alloc(N);
  assert.equal(pickFrame(b, draw, N).source, 'cart');
  assert.equal(drew, 0);
});

test('pickFrame copies a partial view into a fresh exact-size array', () => {
  const backing = new Uint8Array(N * 2).map((_, i) => i % 251);
  const views = [backing.subarray(N, N * 2), backing.subarray(0, N), Buffer.from(backing.buffer, 8, N)];
  for (const view of views) {
    const r = pickFrame(view, () => assert.fail('must not draw'), N);
    assert.equal(r.source, 'cart');
    assert.equal(r.rejected, false);
    assert.equal(r.pixels.byteOffset, 0);
    assert.equal(r.pixels.byteLength, N);
    assert.equal(r.pixels.buffer.byteLength, N);
    assert.notEqual(r.pixels.buffer, backing.buffer);
    assert.ok(same(r.pixels, view));
  }
  const exact = good();
  assert.equal(pickFrame(exact, () => assert.fail('must not draw'), N).pixels, exact);
});

test('pickFrame falls back for null and undefined', () => {
  for (const v of [null, undefined]) {
    let drew = 0;
    const own = new Uint8Array(N);
    const r = pickFrame(v, () => { drew++; return own; }, N);
    assert.equal(r.source, 'companion');
    assert.equal(r.pixels, own);
    assert.equal(r.rejected, false);
    assert.equal(drew, 1);
  }
});

test('pickFrame rejects wrong length and wrong types without throwing', () => {
  for (const v of [new Uint8Array(N - 4), Array.from({ length: N }, () => 0), 'x', { length: N }, 5]) {
    const r = pickFrame(v, () => new Uint8Array(N), N);
    assert.equal(r.source, 'companion');
    assert.equal(r.rejected, true);
  }
});

test('picker logs each switch once, in order', () => {
  const F = good();
  const seq = [null, F, F, null, null];
  let i = 0;
  const logs = [];
  const p = createVideoPicker({ getCartFrame: () => seq[i++], drawOwnPicture: () => new Uint8Array(N), expectedLength: N, log: m => logs.push(m) });
  for (let k = 0; k < seq.length; k++) p.next();
  assert.deepEqual(logs, ['[agent] video: cart', '[agent] video: companion']);
});

test('picker logs a wrong-size frame once and returns companion pixels', () => {
  const logs = [];
  const own = new Uint8Array(N);
  const p = createVideoPicker({ getCartFrame: () => new Uint8Array(3), drawOwnPicture: () => own, expectedLength: N, log: m => logs.push(m) });
  for (let k = 0; k < 3; k++) assert.equal(p.next(), own);
  assert.deepEqual(logs, ['[agent] cart frame ignored: wrong size']);
});

test('picker logs a throwing getCartFrame once and returns companion pixels', () => {
  const logs = [];
  const own = new Uint8Array(N);
  const p = createVideoPicker({ getCartFrame: () => { throw new Error('secret detail'); }, drawOwnPicture: () => own, expectedLength: N, log: m => logs.push(m) });
  for (let k = 0; k < 3; k++) assert.equal(p.next(), own);
  assert.deepEqual(logs, ['[agent] cart frame failed']);
});

test('a throwing logger does not break next()', () => {
  const F = good();
  const p = createVideoPicker({ getCartFrame: () => F, drawOwnPicture: () => new Uint8Array(N), expectedLength: N, log: () => { throw new Error('x'); } });
  assert.equal(p.next(), F);
});

test('createCompanionFrames matches drawCompanion and animates', () => {
  const companion = createCompanionFrames();
  assert.equal(companion.frame(0, false).length, WIDTH * HEIGHT * 4);
  for (const tick of [0, 1, 2, 5, 59, 60, 61, 77]) {
    for (const speaking of [false, true]) {
      assert.ok(same(companion.frame(tick, speaking), drawCompanion(tick, speaking)), `tick ${tick}, speaking=${speaking}`);
    }
  }
  assert.ok(!same(companion.frame(0, false), companion.frame(1, false)));
  assert.ok(!same(companion.frame(1, true), companion.frame(1, false)));
  assert.notEqual(companion.frame(1, false).buffer, companion.frame(1, false).buffer);
});

test('createCompanionFrames renders only at creation', () => {
  let count = 0;
  const companion = createCompanionFrames({ render: args => { count++; return renderCompanionBase(args); } });
  const after = count;
  assert.equal(after, 1);
  for (let t = 0; t < 300; t++) companion.frame(t, t % 7 < 3);
  assert.equal(count, after);
});

test('abstract companion keeps the outer 9% bands background-only at the safe scale', () => {
  const MX = Math.floor(0.09 * WIDTH), MY = Math.floor(0.09 * HEIGHT);
  const BG = [20, 40, 39, 255];
  const check = (px, label) => {
    assert.equal(px.length, WIDTH * HEIGHT * 4);
    let inside = false;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const isBg = BG.every((v, k) => px[i + k] === v);
      const inner = x >= MX && x < WIDTH - MX && y >= MY && y < HEIGHT - MY;
      if (!inner) assert.ok(isBg, `${label}: margin pixel ${x},${y}`);
      else if (!isBg) inside = true;
    }
    assert.ok(inside, label);
  };
  const companion = createCompanionFrames({ scale: SAFE_SCALE_DEFAULT });
  for (const tick of [0, 1, 5, 30, 59, 100, 200, 210, 215, 300]) {
    const speaking = tick % 2 === 0;
    check(drawCompanion(tick, speaking, SAFE_SCALE_DEFAULT), `drawCompanion ${tick}`);
    const f = companion.frame(tick, speaking);
    check(f, `frame ${tick}`);
    assert.ok(same(f, drawCompanion(tick, speaking, SAFE_SCALE_DEFAULT)), `match ${tick}`);
  }
});

test('abstract companion has a warm core inside the safe area at scale 1', () => {
  const px = drawCompanion(5, false, 1);
  const index = (360 * WIDTH + 270) * 4;
  assert.ok(px[index] > 220 && px[index + 1] > 200 && px[index] > px[index + 2]);
});
