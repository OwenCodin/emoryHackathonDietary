import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  captureCartFrame,
  getCartFrame,
  setCartFrame,
  setCartFrameActive,
} from './frames.mjs';
import { HEIGHT, SAFE_SCALE, WIDTH, safeArea } from '../shared/video.mjs';

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

test('browser frame is fitted inside the safe area on white', async () => {
  const png = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#123456' } }).png().toBuffer();
  setCartFrameActive(true);
  const frame = await captureCartFrame({ screenshot: async () => png });
  const a = safeArea(SAFE_SCALE);
  const at = (x, y) => Array.from(frame.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4));
  assert.equal(frame.byteLength, WIDTH * HEIGHT * 4);
  const mx = Math.floor(0.09 * WIDTH), my = Math.floor(0.09 * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (x < mx || x >= WIDTH - mx || y < my || y >= HEIGHT - my) {
        assert.deepEqual(at(x, y), [255, 255, 255, 255], `margin ${x},${y}`);
      }
    }
  }
  assert.deepEqual(at(WIDTH / 2, HEIGHT / 2), [18, 52, 86, 255]);
  assert.deepEqual(at(a.x + 2, a.y + 2), [18, 52, 86, 255]);
  setCartFrameActive(false);
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
