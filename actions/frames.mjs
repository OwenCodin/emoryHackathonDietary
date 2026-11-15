import sharp from 'sharp';
import { HEIGHT, SAFE_SCALE, WIDTH, safeArea } from '../shared/video.mjs';

let latestFrame = null;
let cartActive = false;

export async function captureCartFrame(page) {
  const png = await page.screenshot({ type: 'png' });
  // The picture is fitted into the safe rectangle on white, so a zoomed FaceTime view does not cut it off.
  const a = safeArea(SAFE_SCALE);
  const rgba = await sharp(png)
    .resize(a.width, a.height, { fit: 'contain', background: '#ffffff' })
    .extend({ top: a.y, bottom: HEIGHT - a.y - a.height, left: a.x, right: WIDTH - a.x - a.width, background: '#ffffff' })
    .flatten({ background: '#ffffff' })
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

// Stores a ready-made frame (the Kroger cart card). Only an exact-size Uint8Array is accepted.
export function setCartFrame(rgba) {
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== WIDTH * HEIGHT * 4) return false;
  latestFrame = rgba;
  return true;
}

export function setCartFrameActive(active) {
  cartActive = active;
  if (!active) latestFrame = null;
}
