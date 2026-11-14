import sharp from 'sharp';
import { HEIGHT, WIDTH } from '../shared/video.mjs';

let latestFrame = null;
let cartActive = false;

export async function captureCartFrame(page) {
  const png = await page.screenshot({ type: 'png' });
  const rgba = await sharp(png)
    .resize(WIDTH, HEIGHT, { fit: 'contain', background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  if (rgba.byteLength !== WIDTH * HEIGHT * 4) {
    throw new Error('Unexpected browser frame size');
  }

  latestFrame = Uint8Array.from(rgba);
  return latestFrame;
}

export function getCartFrame() {
  return cartActive ? latestFrame : null;
}

export function setCartFrameActive(active) {
  cartActive = active;
  if (!active) latestFrame = null;
}
