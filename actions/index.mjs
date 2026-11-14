// STUB with canned data. Track C replaces this with the real module and keeps the same exports.
// Every function is async except getCartFrame, takes one object (default {}), never throws, uses no network.

export async function startCart({ items } = {}) {
  return { ok: true };
}

export async function getCartStatus() {
  return {
    ok: true,
    state: 'done',
    step: 'cart filled',
    added: [{ name: 'unsalted chicken broth', price: 3.49 }],
    missing: [],
    total: 3.49,
    cartUrl: 'https://example.com/cart',
  };
}

// Synchronous: called 15 times a second. null means no cart is running, so the agent shows its face.
export function getCartFrame() {
  return null;
}

export async function stopCart() {
  return { ok: true };
}

export async function callPatient({ phone, reason } = {}) {
  return { ok: true, callId: 'stub-call-1' };
}

export async function sendText({ phone, text } = {}) {
  return { ok: true };
}
