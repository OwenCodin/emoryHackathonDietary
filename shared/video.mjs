// The only place the video size and rate are defined.
// Track C's getCartFrame must return WIDTH * HEIGHT * 4 RGBA bytes.
export const WIDTH = 1280;
export const HEIGHT = 720;
export const FPS = 30;

// FaceTime shows the video zoomed on the caller's phone, so content is drawn inside a centred safe area
// while backgrounds still fill the whole frame. VIDEO_SAFE_SCALE tunes it (0.5 to 1), read once at import.
export const SAFE_SCALE_DEFAULT = 0.8;

export function safeScaleFrom(env) {
  const raw = env?.VIDEO_SAFE_SCALE;
  if (typeof raw !== 'string' && typeof raw !== 'number') return SAFE_SCALE_DEFAULT;
  if (typeof raw === 'string' && raw.trim() === '') return SAFE_SCALE_DEFAULT;
  const n = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isFinite(n)) return SAFE_SCALE_DEFAULT;
  return Math.min(1, Math.max(0.5, n));
}

export const SAFE_SCALE = safeScaleFrom(globalThis.process?.env);

export function safeArea(scale = SAFE_SCALE) {
  const x = Math.round(WIDTH * (1 - scale) / 2);
  const y = Math.round(HEIGHT * (1 - scale) / 2);
  return Object.freeze({ x, y, width: WIDTH - 2 * x, height: HEIGHT - 2 * y, scale });
}

export const SAFE = safeArea(SAFE_SCALE);

// Maps a point (px, py) of the full-frame design to (x + px * scale, y + py * scale).
export function safeTransform(scale = SAFE_SCALE) {
  const { x, y } = safeArea(scale);
  return `translate(${x} ${y}) scale(${scale})`;
}
