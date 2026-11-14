// The picture your caller sees: one RGBA frame per call to drawFace. Replace this file to show anything you like.
// The frame size comes from shared/video.mjs. Pixel offsets are scaled by HEIGHT / 360 so the face keeps its proportions.
import { HEIGHT, WIDTH } from '../shared/video.mjs';

const SCALE = HEIGHT / 360;

const BACKGROUND = [16, 40, 52], FACE = [141, 224, 196], INK = [16, 40, 52], ACCENT = [255, 200, 118];

/**
 * The per-pixel renderer. `blink` is a boolean, `mouth` is the mouth half-height in pixels (already scaled) and
 * `bar` is the accent bar's left x, or null for no bar. Returns WIDTH x HEIGHT pixels, four bytes each.
 */
export function renderFace({ blink, mouth, bar }) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const cx = WIDTH / 2, cy = HEIGHT / 2 - 10 * SCALE, radius = HEIGHT * 0.36;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let color = BACKGROUND;
      if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) color = FACE;
      const eye = Math.abs(x - (cx - 45 * SCALE)) < 10 * SCALE || Math.abs(x - (cx + 45 * SCALE)) < 10 * SCALE;
      if (eye && Math.abs(y - (cy - 35 * SCALE)) < (blink ? 2 : 14) * SCALE) color = INK;
      if (((x - cx) / (48 * SCALE)) ** 2 + ((y - (cy + 45 * SCALE)) / mouth) ** 2 < 1) color = INK;
      if (bar !== null && y > HEIGHT - 22 * SCALE && y < HEIGHT - 12 * SCALE && x > bar && x < bar + 40 * SCALE) color = ACCENT;
      const i = (y * WIDTH + x) * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const barAt = tick => (tick * 6 * SCALE) % (WIDTH - 40 * SCALE); // a moving bar, so a frozen picture is easy to spot

/**
 * A simple animated face. `tick` counts frames; `speaking` is true while the agent talks, and opens the mouth.
 * Returns WIDTH x HEIGHT pixels, four bytes each: red, green, blue, alpha.
 */
export function drawFace(tick, speaking) {
  return renderFace({
    blink: tick % 60 < 3,                                       // a short blink every four seconds
    mouth: (speaking ? 6 + 14 * Math.abs(Math.sin(tick * 0.8)) : 4) * SCALE,
    bar: barAt(tick),
  });
}

/**
 * Pre-renders a few base frames once (idle, blink, three mouth-open states, all without the bar) so each tick
 * only copies one and paints the moving bar. frame() always returns a fresh buffer.
 */
export function createFaceFrames({ render = renderFace } = {}) {
  const idle = render({ blink: false, mouth: 4 * SCALE, bar: null });
  const blinkFrame = render({ blink: true, mouth: 4 * SCALE, bar: null });
  const open = [1 / 3, 2 / 3, 1].map(k => render({ blink: false, mouth: (6 + 14 * k) * SCALE, bar: null }));
  return {
    frame(tick, speaking) {
      let base = idle;
      if (speaking) base = open[Math.min(2, Math.floor(Math.abs(Math.sin(tick * 0.8)) * 3))];
      else if (tick % 60 < 3) base = blinkFrame;
      const pixels = base.slice();
      const bar = barAt(tick);
      for (let y = 0; y < HEIGHT; y++) {
        if (!(y > HEIGHT - 22 * SCALE && y < HEIGHT - 12 * SCALE)) continue;
        for (let x = 0; x < WIDTH; x++) {
          if (!(x > bar && x < bar + 40 * SCALE)) continue;
          const i = (y * WIDTH + x) * 4;
          pixels[i] = ACCENT[0]; pixels[i + 1] = ACCENT[1]; pixels[i + 2] = ACCENT[2]; pixels[i + 3] = 255;
        }
      }
      return pixels;
    },
  };
}
