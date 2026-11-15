import { HEIGHT, SAFE_SCALE, WIDTH, safeArea } from '../shared/video.mjs';
import { UI_TOKENS } from './card.mjs';

const CENTER_X = 640;
const CENTER_Y = 254;
const RADIUS = 88;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const smoothstep = value => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const STATES = Object.freeze({
  idle: { scale: 1, glow: 0.46, rotation: 0, ring: 0, softness: 0.12 },
  listening: { scale: 0.94, glow: 0.34, rotation: 0, ring: 0.55, softness: 0.1 },
  looking: { scale: 1, glow: 0.48, rotation: 0, ring: 0.9, softness: 0.17 },
  thinking: { scale: 1, glow: 0.44, rotation: 1, ring: 0, softness: 0.14 },
  speaking: { scale: 1, glow: 0.54, rotation: 0.15, ring: 0, softness: 0.2 },
});

const ORB_COLORS = Object.freeze({
  teal: hexRgb(UI_TOKENS.colors.orbA),
  blue: hexRgb(UI_TOKENS.colors.orbB),
  highlight: hexRgb(UI_TOKENS.colors.orbHighlight),
  ring: hexRgb(UI_TOKENS.colors.orbRing),
});
const blend = (pixels, index, red, green, blue, alpha) => {
  const inverse = 1 - alpha;
  pixels[index] = Math.round(pixels[index] * inverse + red * alpha);
  pixels[index + 1] = Math.round(pixels[index + 1] * inverse + green * alpha);
  pixels[index + 2] = Math.round(pixels[index + 2] * inverse + blue * alpha);
};

export function createOrbPainter({ reducedMotion = false, now = () => performance.now() } = {}) {
  let smoothedOutput = 0;
  let smoothedMic = 0;
  let previousState = 'idle';
  let previousTime = now();
  let lastPulseAt = -Infinity;
  let ripples = [];

  return function paintOrb(pixels, { state = 'idle', fromState = state, transition = 1, outputLevel = null, micLevel = null, time = now() } = {}) {
    const safeState = Object.hasOwn(STATES, state) ? state : 'idle';
    const start = Object.hasOwn(STATES, fromState) ? fromState : previousState;
    const dt = clamp((time - previousTime) / 1000, 0, 0.1);
    previousTime = time;
    previousState = safeState;

    const targetOutput = Number.isFinite(outputLevel) ? clamp(outputLevel, 0, 1) : 0;
    const targetMic = Number.isFinite(micLevel) ? clamp(micLevel, 0, 1) : 0;
    const attack = 1 - Math.exp(-dt / 0.055);
    const release = 1 - Math.exp(-dt / 0.24);
    smoothedOutput += (targetOutput - smoothedOutput) * (targetOutput > smoothedOutput ? attack : release);
    smoothedMic += (targetMic - smoothedMic) * (targetMic > smoothedMic ? attack : release);

    const blendState = lerp(STATES[start].scale, STATES[safeState].scale, smoothstep(transition));
    const glowState = lerp(STATES[start].glow, STATES[safeState].glow, smoothstep(transition));
    const ringState = lerp(STATES[start].ring, STATES[safeState].ring, smoothstep(transition));
    const speaking = safeState === 'speaking' && !reducedMotion ? smoothedOutput : 0;
    const reduced = reducedMotion === true;
    const phase = time / 1000;
    const breath = reduced ? Math.sin(phase * 0.35) * 0.02 : Math.sin(phase * 0.34) * 0.035;
    const scale = blendState * (1 + breath + speaking * 0.075);
    const radius = RADIUS * SAFE_SCALE * scale;
    const area = safeArea(SAFE_SCALE);
    const cx = Math.round(area.x + CENTER_X * SAFE_SCALE);
    const cy = Math.round(area.y + CENTER_Y * SAFE_SCALE);
    const glow = glowState * (1 + Math.sin(phase * 0.5) * 0.06);
    const minX = Math.max(0, Math.floor(cx - radius * 2.15));
    const maxX = Math.min(WIDTH - 1, Math.ceil(cx + radius * 2.15));
    const minY = Math.max(0, Math.floor(cy - radius * 2.15));
    const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + radius * 2.15));
    const rotation = reduced ? 0 : safeState === 'thinking' ? phase * 0.18 : phase * 0.015;
    const rippleThreshold = 0.36;

    if (!reduced && safeState === 'speaking' && outputLevel !== null && speaking >= rippleThreshold && time - lastPulseAt > 420) {
      lastPulseAt = time;
      ripples.push({ start: time, radius: radius * 1.12 });
    }
    ripples = reduced ? [] : ripples.filter(ripple => time - ripple.start < 1050);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const index = (y * WIDTH + x) * 4;
        if (distance > radius * 2) continue;

        if (distance > radius * 0.82) {
          const haloAlpha = glow * Math.pow(clamp(1 - distance / (radius * 2), 0, 1), 2.4) * 0.42;
          if (haloAlpha > 0.002) blend(pixels, index, ...ORB_COLORS.teal, haloAlpha);
        }

        for (const ripple of ripples) {
          const progress = (time - ripple.start) / 1050;
          const ringRadius = ripple.radius + progress * radius * 0.92;
          if (Math.abs(distance - ringRadius) < 1.4) {
            const alpha = (1 - progress) * 0.22;
            blend(pixels, index, 177, 235, 238, alpha);
          }
        }

        const edge = clamp((radius - distance) / Math.max(1, radius * (STATES[safeState].softness + speaking * 0.08)), 0, 1);
        if (edge <= 0) continue;
        const angle = Math.atan2(dy, dx) - rotation;
        const gradient = clamp(0.52 + Math.cos(angle) * 0.24 + (dy / radius) * 0.28, 0, 1);
        const red = lerp(ORB_COLORS.teal[0], ORB_COLORS.blue[0], gradient);
        const green = lerp(ORB_COLORS.teal[1], ORB_COLORS.blue[1], gradient);
        const blue = lerp(ORB_COLORS.teal[2], ORB_COLORS.blue[2], gradient);
        const shine = clamp(0.45 - ((dx + dy) / (radius * 2)), 0, 0.38) * edge;
        blend(
          pixels,
          index,
          lerp(red, ORB_COLORS.highlight[0], shine),
          lerp(green, ORB_COLORS.highlight[1], shine),
          lerp(blue, ORB_COLORS.highlight[2], shine),
          edge,
        );
      }
    }

    if (ringState > 0 && !reduced) {
      const micResponse = Number.isFinite(micLevel) ? smoothedMic : 0.08;
      const ringRadius = radius * (1.2 + micResponse * 0.12);
      const angle = phase * (safeState === 'looking' ? 0.3 : 0.12);
      const sweep = safeState === 'looking' ? 0.32 : Math.PI * 2;
      const left = Math.max(0, Math.floor(cx - ringRadius - 2));
      const right = Math.min(WIDTH - 1, Math.ceil(cx + ringRadius + 2));
      const top = Math.max(0, Math.floor(cy - ringRadius - 2));
      const bottom = Math.min(HEIGHT - 1, Math.ceil(cy + ringRadius + 2));
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const dx = x - cx, dy = y - cy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const a = Math.atan2(dy, dx);
          const along = ((a - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          const visible = safeState !== 'looking' || along < sweep || along > Math.PI * 2 - 0.08;
          if (visible && Math.abs(distance - ringRadius) < 0.8) {
            blend(pixels, (y * WIDTH + x) * 4, ...ORB_COLORS.ring, ringState * 0.3);
          }
        }
      }
    }
  };
}

function hexRgb(hex) {
  const value = hex.startsWith('#') ? hex.slice(1) : hex;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}
