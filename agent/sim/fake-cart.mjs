// Fake cart frame provider for the SIMULATED PROOF only.
// The agent uses it only when AGENT_FAKE_CART is exactly '1' (decided in agent/agent.mjs; this file reads no environment).
// It stands in for Track C's getCartFrame: nothing for 6 s after start(), then a solid magenta frame for 6 s, then nothing.
// The helpers isMagenta and followsCompanionCartCompanion classify what the caller sees.
import { HEIGHT, WIDTH } from '../../shared/video.mjs';

export const FAKE_CART_DELAY_MS = 6000;
export const FAKE_CART_SHOW_MS = 6000;

export function createFakeCart({ now = () => Date.now() } = {}) {
  let startedAt = null;
  let magenta = null;
  return {
    start() { if (startedAt === null) startedAt = now(); },
    getCartFrame() {
      if (startedAt === null) return null;
      const elapsed = now() - startedAt;
      if (elapsed < FAKE_CART_DELAY_MS || elapsed >= FAKE_CART_DELAY_MS + FAKE_CART_SHOW_MS) return null;
      if (magenta === null) {
        magenta = new Uint8Array(WIDTH * HEIGHT * 4);
        for (let i = 0; i < magenta.length; i += 4) { magenta[i] = 255; magenta[i + 1] = 0; magenta[i + 2] = 255; magenta[i + 3] = 255; }
      }
      return magenta;
    },
  };
}

// Tolerates video compression; the companion, background and accent colours are all outside this range.
export function isMagenta(r, g, b) {
  return r >= 180 && g <= 90 && b >= 180;
}

// True when the timeline contains 'companion', later 'cart', later 'companion' (a subsequence).
export function followsCompanionCartCompanion(timeline) {
  if (!Array.isArray(timeline)) return false;
  const want = ['companion', 'cart', 'companion'];
  let k = 0;
  for (const entry of timeline) if (k < want.length && entry === want[k]) k++;
  return k === want.length;
}
