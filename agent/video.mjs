// Which picture goes out on each frame tick: Track C's browser frame when one is offered, otherwise the agent's own picture.
// No LiveKit imports, so everything here is unit tested offline.

// Never throws. A cart frame is accepted only as a Uint8Array of exactly expectedLength bytes.
// VideoFrame reads the whole backing buffer from offset 0 and ignores byteOffset, so a partial view
// (a Buffer slice or subarray) is copied into a fresh exact-size array first.
export function pickFrame(cartFrame, drawOwnPicture, expectedLength) {
  try {
    if (cartFrame instanceof Uint8Array && cartFrame.length === expectedLength) {
      const exact = cartFrame.byteOffset === 0 && cartFrame.byteLength === cartFrame.buffer.byteLength;
      return { source: 'cart', pixels: exact ? cartFrame : new Uint8Array(cartFrame), rejected: false };
    }
  } catch { /* fall through to the agent's own picture */ }
  return { source: 'face', pixels: drawOwnPicture(), rejected: cartFrame !== null && cartFrame !== undefined };
}

// One picker per call: it remembers what it already logged, so nothing is logged on every tick.
export function createVideoPicker({ getCartFrame, drawOwnPicture, expectedLength, log = message => console.log(message) }) {
  let current = 'face', loggedFailed = false, loggedIgnored = false;
  const say = message => { try { log(message); } catch { /* logging must never break the video */ } };
  return {
    next() {
      let cart = null;
      try { cart = getCartFrame(); }
      catch {
        cart = null;
        if (!loggedFailed) { loggedFailed = true; say('[agent] cart frame failed'); }
      }
      const result = pickFrame(cart, drawOwnPicture, expectedLength);
      if (result.rejected && !loggedIgnored) { loggedIgnored = true; say('[agent] cart frame ignored: wrong size'); }
      if (result.source !== current) { current = result.source; say(`[agent] video: ${current}`); }
      return result.pixels;
    },
  };
}
