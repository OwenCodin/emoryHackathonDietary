import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPicker, pickFrame } from './video.mjs';

const N = 64;
const good = () => new Uint8Array(N);
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test('pickFrame accepts an exact frame without drawing the UI', () => {
  let drew = 0;
  const frame = good();
  assert.deepEqual(pickFrame(frame, () => { drew++; return good(); }, N), {
    source: 'cart',
    pixels: frame,
    rejected: false,
  });
  assert.equal(drew, 0);
});

test('pickFrame copies partial views into an exact-size frame', () => {
  const backing = new Uint8Array(N * 2).map((_, index) => index % 251);
  for (const view of [backing.subarray(N), backing.subarray(0, N), Buffer.from(backing.buffer, 8, N)]) {
    const result = pickFrame(view, () => assert.fail('must not render the UI'), N);
    assert.equal(result.source, 'cart');
    assert.equal(result.pixels.byteOffset, 0);
    assert.equal(result.pixels.byteLength, N);
    assert.notEqual(result.pixels.buffer, backing.buffer);
    assert.ok(same(result.pixels, view));
  }
});

test('picker falls back to the agent UI and logs source transitions once', () => {
  const frame = good();
  const sequence = [null, frame, frame, null, null];
  const logs = [];
  let index = 0;
  const picker = createVideoPicker({
    getCartFrame: () => sequence[index++],
    drawOwnPicture: () => new Uint8Array(N),
    expectedLength: N,
    log: message => logs.push(message),
  });
  for (let i = 0; i < sequence.length; i++) picker.next();
  assert.deepEqual(logs, ['[agent] video: cart', '[agent] video: ui']);
});

test('picker rejects invalid or throwing cart frames without disrupting the call', () => {
  for (const getCartFrame of [
    () => new Uint8Array(N - 1),
    () => { throw new Error('private detail'); },
  ]) {
    const logs = [];
    const own = new Uint8Array(N);
    const picker = createVideoPicker({
      getCartFrame,
      drawOwnPicture: () => own,
      expectedLength: N,
      log: message => logs.push(message),
    });
    for (let i = 0; i < 3; i++) assert.equal(picker.next(), own);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('cart frame'));
  }
});

test('a throwing logger does not break frame selection', () => {
  const frame = good();
  const picker = createVideoPicker({
    getCartFrame: () => frame,
    drawOwnPicture: () => assert.fail('should use the cart frame'),
    expectedLength: N,
    log: () => { throw new Error('logger failure'); },
  });
  assert.equal(picker.next(), frame);
});
