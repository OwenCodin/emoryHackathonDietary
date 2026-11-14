import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  captureCartFrame,
  getCartFrame,
  setCartFrame,
  setCartFrameActive,
} from './frames.mjs';
import { HEIGHT, WIDTH } from '../shared/video.mjs';

test('cart frame is hidden while no cart is active', () => {
  setCartFrameActive(false);
  assert.equal(getCartFrame(), null);
});

test('cart frame is exact-size RGBA while active', async () => {
  const png = await sharp({
    create: {
      width: 12,
      height: 9,
      channels: 3,
      background: '#123456',
    },
  })
    .png()
    .toBuffer();

  setCartFrameActive(true);
  const frame = await captureCartFrame({
    screenshot: async () => png,
  });

  assert.ok(frame instanceof Uint8Array);
  assert.equal(frame.byteLength, WIDTH * HEIGHT * 4);
  assert.equal(getCartFrame()?.byteLength, WIDTH * HEIGHT * 4);

  setCartFrameActive(false);
  assert.equal(getCartFrame(), null);
});

test('setCartFrame accepts only an exact-size Uint8Array', () => {
  setCartFrameActive(false);
  const good = new Uint8Array(WIDTH * HEIGHT * 4);
  assert.equal(setCartFrame(good), true);
  assert.equal(getCartFrame(), null);
  setCartFrameActive(true);
  assert.equal(getCartFrame(), good);

  assert.equal(setCartFrame(new Uint8Array(10)), false);
  assert.equal(setCartFrame(null), false);
  assert.equal(setCartFrame('x'), false);
  assert.equal(getCartFrame(), good);

  setCartFrameActive(false);
  assert.equal(getCartFrame(), null);
});
