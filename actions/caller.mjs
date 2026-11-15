// Reads the caller's phone number from the Chert call record. The overall 1.5 s budget is also
// enforced by the caller (agent/caller.mjs); the per-request timeout here is a second guard.
// Never throws. Never logs the number, the call id, or any response body.
const API_BASE = 'https://app.trychert.com/api/v1';
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

function pickRecord(body, callId) {
  const candidates = [body?.data?.items?.[0], body?.data, body];
  return candidates.find((c) => c && typeof c === 'object' && c.id === callId) ?? null;
}

function pickFromList(body, callId) {
  const items = Array.isArray(body?.data?.items) ? body.data.items : Array.isArray(body?.data) ? body.data : [];
  return items.find((c) => c?.id === callId) ?? null;
}

export function createCallerLookup({ fetchImpl = fetch, env = process.env, timeoutMs = 1500 } = {}) {
  async function get(path, headers) {
    const response = await fetchImpl(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return response.json();
  }

  return async function getCallerPhone({ callId } = {}) {
    try {
      if (typeof callId !== 'string' || !CALL_ID.test(callId)) return { ok: false, error: 'bad_call_id' };
      const apiKey = env.CHERT_API_KEY;
      const projectId = env.CHERT_PROJECT_ID;
      if (!apiKey || !projectId || !apiKey.startsWith('ftk_')) return { ok: false, error: 'not_configured' };
      const headers = { Authorization: `Bearer ${apiKey}`, 'X-Chert-Project-Id': projectId };

      let record = null;
      try {
        const body = await get(`/calls/${encodeURIComponent(callId)}`, headers);
        if (body) record = pickRecord(body, callId);
      } catch {
        // fall through to the list
      }
      if (!record) {
        const body = await get('/calls?limit=20', headers);
        if (body) record = pickFromList(body, callId);
      }
      if (!record) return { ok: false, error: 'not_found' };
      const from = record.from;
      if (from?.type !== 'phone_number' || typeof from.value !== 'string' || !E164.test(from.value)) {
        return { ok: false, error: 'not_a_phone' };
      }
      return { ok: true, phone: from.value };
    } catch {
      return { ok: false, error: 'lookup_failed' };
    }
  };
}

export const getCallerPhone = (args) => createCallerLookup()(args);
