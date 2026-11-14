// The picture your caller sees: one RGBA frame per call to drawFace. Replace this file to show anything you like.
// The frame size comes from shared/video.mjs. Pixel offsets are scaled by HEIGHT / 360 so the face keeps its proportions.
// The face is designed at full size and drawn inside the shared safe area (FaceTime zooms the picture on the caller's phone).
import { HEIGHT, SAFE_SCALE, WIDTH, safeArea } from '../shared/video.mjs';

const SCALE = HEIGHT / 360;

const BACKGROUND = [16, 40, 52], SKIN = [220, 165, 137], HAIR = [37, 32, 39], INK = [52, 40, 42], ACCENT = [255, 200, 118];

/**
 * The per-pixel renderer. `blink` is a boolean, `mouth` is the mouth half-height in pixels (already scaled) and
 * `bar` is the accent bar's left x, or null for no bar. Returns WIDTH x HEIGHT pixels, four bytes each.
 */
export function renderFace({ blink, mouth, bar, scale = SAFE_SCALE }) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const a = safeArea(scale);
  const cx = WIDTH / 2, cy = HEIGHT / 2 - 18 * SCALE;
  const ellipse = (x, y, x0, y0, rx, ry) => ((x - x0) / rx) ** 2 + ((y - y0) / ry) ** 2 < 1;
  for (let fy = 0; fy < HEIGHT; fy++) {
    for (let fx = 0; fx < WIDTH; fx++) {
      const x = (fx - a.x) / scale, y = (fy - a.y) / scale; // design coordinates
      let color = BACKGROUND;
      if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
        const face = ellipse(x, y, cx, cy, 176 * SCALE, 231 * SCALE);
        const inHair = ellipse(x, y, cx, cy - 25 * SCALE, 204 * SCALE, 251 * SCALE);
        const shoulders = ellipse(x, y, cx, HEIGHT + 18 * SCALE, 300 * SCALE, 242 * SCALE);
        if (shoulders) color = [211, 228, 218];
        if (shoulders && Math.abs(x - cx) < 103 * SCALE && y > cy + 185 * SCALE) color = [48, 132, 124];
        if (ellipse(x, y, cx, cy + 204 * SCALE, 59 * SCALE, 91 * SCALE)) color = SKIN;
        if (inHair) color = HAIR;
        if (ellipse(x, y, cx - 171 * SCALE, cy + 31 * SCALE, 27 * SCALE, 47 * SCALE)
          || ellipse(x, y, cx + 171 * SCALE, cy + 31 * SCALE, 27 * SCALE, 47 * SCALE)) color = SKIN;
        if (face) {
          const shade = Math.max(0, Math.min(20, Math.round((cy - y) / (231 * SCALE) * 10 + (cx - x) / (176 * SCALE) * 8)));
          color = [Math.min(255, SKIN[0] + shade), Math.min(255, SKIN[1] + shade), Math.min(255, SKIN[2] + shade)];
        }
        const dx = Math.abs(x - cx);
        const hairline = y < cy - (125 - dx * 0.18) * SCALE && inHair;
        const sideHair = dx > 147 * SCALE && dx < 203 * SCALE && y > cy - 126 * SCALE && y < cy + 154 * SCALE;
        if (hairline || sideHair) color = HAIR;

        const eyeY = cy - 32 * SCALE;
        const eyeX = 56 * SCALE;
        const leftEye = ellipse(x, y, cx - eyeX, eyeY, 26 * SCALE, (blink ? 3 : 15) * SCALE);
        const rightEye = ellipse(x, y, cx + eyeX, eyeY, 26 * SCALE, (blink ? 3 : 15) * SCALE);
        if ((leftEye || rightEye) && !blink) color = [250, 244, 235];
        if (!blink && (ellipse(x, y, cx - eyeX, eyeY, 7 * SCALE, 10 * SCALE)
          || ellipse(x, y, cx + eyeX, eyeY, 7 * SCALE, 10 * SCALE))) color = [81, 117, 110];
        if (!blink && (ellipse(x, y, cx - eyeX, eyeY, 3 * SCALE, 6 * SCALE)
          || ellipse(x, y, cx + eyeX, eyeY, 3 * SCALE, 6 * SCALE))) color = INK;
        const leftBrow = ellipse(x, y, cx - eyeX, cy - 63 * SCALE, 36 * SCALE, 7 * SCALE);
        const rightBrow = ellipse(x, y, cx + eyeX, cy - 63 * SCALE, 36 * SCALE, 7 * SCALE);
        if (leftBrow || rightBrow) color = [91, 62, 56];
        if (Math.abs(x - cx) < 6 * SCALE && y > cy - 8 * SCALE && y < cy + 73 * SCALE) color = [177, 115, 96];
        const mouthRx = 25 * SCALE, mouthRy = Math.max(2 * SCALE, mouth);
        if (ellipse(x, y, cx, cy + 111 * SCALE, mouthRx + 5 * SCALE, mouthRy + 4 * SCALE)) color = [155, 83, 87];
        if (ellipse(x, y, cx, cy + 111 * SCALE, mouthRx, mouthRy)) color = INK;
        if (ellipse(x, y, cx, cy + 111 * SCALE + mouthRy * 0.55, 11 * SCALE, 2 * SCALE)) color = [205, 116, 117];
        if (bar !== null && y > HEIGHT - 22 * SCALE && y < HEIGHT - 12 * SCALE && x > bar && x < bar + 40 * SCALE) color = ACCENT;
      }
      const i = (fy * WIDTH + fx) * 4;
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
export function drawFace(tick, speaking, scale = SAFE_SCALE) {
  return renderFace({
    blink: tick % 60 < 3,                                       // a short blink every four seconds
    mouth: (speaking ? 6 + 14 * Math.abs(Math.sin(tick * 0.8)) : 4) * SCALE,
    bar: barAt(tick),
    scale,
  });
}

/**
 * Pre-renders a few base frames once (idle, blink, three mouth-open states, all without the bar) so each tick
 * only copies one and paints the moving bar. frame() always returns a fresh buffer.
 */
export function createFaceFrames({ render = renderFace, scale = SAFE_SCALE } = {}) {
  const a = safeArea(scale);
  const idle = render({ blink: false, mouth: 4 * SCALE, bar: null, scale });
  const blinkFrame = render({ blink: true, mouth: 4 * SCALE, bar: null, scale });
  const open = [1 / 3, 2 / 3, 1].map(k => render({ blink: false, mouth: (6 + 14 * k) * SCALE, bar: null, scale }));
  return {
    frame(tick, speaking) {
      let base = idle;
      if (speaking) base = open[Math.min(2, Math.floor(Math.abs(Math.sin(tick * 0.8)) * 3))];
      else if (tick % 60 < 3) base = blinkFrame;
      const pixels = base.slice();
      const bar = barAt(tick);
      // Only the rows and columns the mapped bar can cover, using the same inverse mapping as renderFace.
      const y0 = Math.max(0, Math.floor(a.y + (HEIGHT - 22 * SCALE) * scale));
      const y1 = Math.min(HEIGHT, Math.ceil(a.y + (HEIGHT - 12 * SCALE) * scale) + 1);
      const x0 = Math.max(0, Math.floor(a.x + bar * scale));
      const x1 = Math.min(WIDTH, Math.ceil(a.x + (bar + 40 * SCALE) * scale) + 1);
      for (let fy = y0; fy < y1; fy++) {
        const y = (fy - a.y) / scale;
        if (!(y > HEIGHT - 22 * SCALE && y < HEIGHT - 12 * SCALE)) continue;
        for (let fx = x0; fx < x1; fx++) {
          const x = (fx - a.x) / scale;
          if (!(x > bar && x < bar + 40 * SCALE)) continue;
          const i = (fy * WIDTH + fx) * 4;
          pixels[i] = ACCENT[0]; pixels[i + 1] = ACCENT[1]; pixels[i + 2] = ACCENT[2]; pixels[i + 3] = 255;
        }
      }
      return pixels;
    },
  };
}
