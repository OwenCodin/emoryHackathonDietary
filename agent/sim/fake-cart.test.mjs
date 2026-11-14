import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../../shared/video.mjs';
import { createFakeCart, followsFaceCartFace, isMagenta } from './fake-cart.mjs';

test('fake cart timeline: null, magenta, null', () => {
  let t = 1000;
  const cart = createFakeCart({ now: () => t });
  assert.equal(cart.getCartFrame(), null, 'before start');
  cart.start();
  const T = 1000;
  for (const [offset, shown] of [[0, false], [5999, false], [6000, true], [11999, true], [12000, false], [60000, false]]) {
    t = T + offset;
    const frame = cart.getCartFrame();
    if (!shown) { assert.equal(frame, null, `offset ${offset}`); continue; }
    assert.ok(frame instanceof Uint8Array);
    assert.equal(frame.length, WIDTH * HEIGHT * 4);
    const centre = ((Math.floor(HEIGHT / 2) * WIDTH) + Math.floor(WIDTH / 2)) * 4;
    assert.deepEqual([...frame.subarray(0, 4)], [255, 0, 255, 255]);
    assert.deepEqual([...frame.subarray(centre, centre + 4)], [255, 0, 255, 255]);
  }
});

test('fake cart: same buffer each time, second start does not move the clock', () => {
  let t = 0;
  const cart = createFakeCart({ now: () => t });
  cart.start();
  t = 5000;
  cart.start();
  t = 6000;
  const a = cart.getCartFrame();
  t = 7000;
  assert.equal(cart.getCartFrame(), a);
  t = 12000;
  assert.equal(cart.getCartFrame(), null);
});

test('isMagenta', () => {
  assert.equal(isMagenta(255, 0, 255), true);
  assert.equal(isMagenta(230, 30, 220), true);
  assert.equal(isMagenta(141, 224, 196), false);
  assert.equal(isMagenta(16, 40, 52), false);
  assert.equal(isMagenta(255, 200, 118), false);
});

test('followsFaceCartFace', () => {
  assert.equal(followsFaceCartFace(['face', 'cart', 'face']), true);
  assert.equal(followsFaceCartFace(['face', 'cart', 'face', 'cart', 'face']), true);
  for (const bad of [[], ['face'], ['face', 'cart'], ['cart', 'face'], ['face', 'face'], ['cart', 'face', 'cart'], null, 'x']) {
    assert.equal(followsFaceCartFace(bad), false);
  }
});
