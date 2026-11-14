import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { createFaceFrames, drawFace, renderFace } from './face.mjs';
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
    assert.equal(r.source, 'face');
    assert.equal(r.pixels, own);
    assert.equal(r.rejected, false);
    assert.equal(drew, 1);
  }
});

test('pickFrame rejects wrong length and wrong types without throwing', () => {
  for (const v of [new Uint8Array(N - 4), Array.from({ length: N }, () => 0), 'x', { length: N }, 5]) {
    const r = pickFrame(v, () => new Uint8Array(N), N);
    assert.equal(r.source, 'face');
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
  assert.deepEqual(logs, ['[agent] video: cart', '[agent] video: face']);
});

test('picker logs a wrong-size frame once and returns face pixels', () => {
  const logs = [];
  const own = new Uint8Array(N);
  const p = createVideoPicker({ getCartFrame: () => new Uint8Array(3), drawOwnPicture: () => own, expectedLength: N, log: m => logs.push(m) });
  for (let k = 0; k < 3; k++) assert.equal(p.next(), own);
  assert.deepEqual(logs, ['[agent] cart frame ignored: wrong size']);
});

test('picker logs a throwing getCartFrame once and returns face pixels', () => {
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

test('createFaceFrames matches drawFace and animates', () => {
  const faces = createFaceFrames();
  assert.equal(faces.frame(0, false).length, WIDTH * HEIGHT * 4);
  for (const tick of [0, 1, 2, 5, 59, 60, 61, 77]) {
    assert.ok(same(faces.frame(tick, false), drawFace(tick, false)), `tick ${tick}`);
  }
  assert.ok(!same(faces.frame(0, false), faces.frame(1, false)));
  assert.ok(!same(faces.frame(1, true), faces.frame(1, false)));
  assert.notEqual(faces.frame(1, false).buffer, faces.frame(1, false).buffer);
});

test('createFaceFrames renders only at creation', () => {
  let count = 0;
  const faces = createFaceFrames({ render: args => { count++; return renderFace(args); } });
  const after = count;
  assert.ok(after <= 8);
  for (let t = 0; t < 300; t++) faces.frame(t, t % 7 < 3);
  assert.equal(count, after);
});
