// Pixel fallback for the abstract RenaLine screen; it does not depend on SVG rendering.
import { HEIGHT, SAFE_SCALE, WIDTH, safeArea } from '../shared/video.mjs';
import { paintVoiceIndicator, VOICE_INDICATOR } from './card.mjs';

const BACKGROUND = [20, 40, 39];
const WARM = [140, 112, 75];
const SAGE = [191, 210, 187];
const CREAM = [216, 188, 145];
const CORE = [23, 47, 48];

function blendPixel(pixels, index, color, alpha) {
  const keep = 1 - alpha;
  pixels[index] = Math.round(pixels[index] * keep + color[0] * alpha);
  pixels[index + 1] = Math.round(pixels[index + 1] * keep + color[1] * alpha);
  pixels[index + 2] = Math.round(pixels[index + 2] * keep + color[2] * alpha);
  pixels[index + 3] = 255;
}

export function renderCompanionBase({ scale = SAFE_SCALE } = {}) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = BACKGROUND[0];
    pixels[i + 1] = BACKGROUND[1];
    pixels[i + 2] = BACKGROUND[2];
    pixels[i + 3] = 255;
  }

  const area = safeArea(scale);
  const cx = area.x + VOICE_INDICATOR.x * scale;
  const cy = area.y + VOICE_INDICATOR.center * scale;
  const outer = 258 * scale;
  const x0 = Math.max(0, Math.floor(cx - outer));
  const x1 = Math.min(WIDTH, Math.ceil(cx + outer));
  const y0 = Math.max(0, Math.floor(cy - outer));
  const y1 = Math.min(HEIGHT, Math.ceil(cy + outer));
  const rings = [
    { radius: 198, color: SAGE, alpha: 0.1 },
    { radius: 150, color: CREAM, alpha: 0.2 },
    { radius: 104, color: SAGE, alpha: 0.32 },
  ];

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x - cx) / scale;
      const dy = (y - cy) / scale;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 258) continue;

      const index = (y * WIDTH + x) * 4;
      const glow = 1 - distance / 258;
      blendPixel(pixels, index, WARM, 0.56 * glow * glow);
      for (const ring of rings) {
        const delta = (distance - ring.radius) / 2.5;
        const alpha = ring.alpha * Math.exp(-delta * delta);
        if (alpha > 0.01) blendPixel(pixels, index, ring.color, alpha);
      }
      if (distance <= 104) blendPixel(pixels, index, CORE, 0.72);
    }
  }
  return pixels;
}

export function drawCompanion(tick, speaking, scale = SAFE_SCALE) {
  const pixels = renderCompanionBase({ scale });
  paintVoiceIndicator(pixels, tick, speaking, scale);
  return pixels;
}

export function createCompanionFrames({ render = renderCompanionBase, scale = SAFE_SCALE } = {}) {
  const base = render({ scale });
  return {
    frame(tick, speaking) {
      const pixels = base.slice();
      paintVoiceIndicator(pixels, tick, speaking, scale);
      return pixels;
    },
  };
}
