import { randomUUID } from 'node:crypto';

const API_BASE = 'https://app.trychert.com/api/v1';

function getSettings(phone, text) {
  const settings = {
    apiKey: process.env.CHERT_API_KEY,
    projectId: process.env.CHERT_PROJECT_ID,
    lineId: process.env.CHERT_LINE_ID,
    patientPhone: process.env.PATIENT_PHONE,
  };
  if (!settings.apiKey || !settings.projectId || !settings.lineId || !settings.patientPhone) {
    return { error: 'Chert messaging configuration is incomplete' };
  }
  if (!settings.apiKey.startsWith('ftk_')) {
    return { error: 'CHERT_API_KEY is not a project API key' };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(settings.patientPhone) || phone !== settings.patientPhone) {
    return { error: 'Recipient must be the configured verified patient number' };
  }
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4000) {
    return { error: 'Text must contain 1 to 4000 characters' };
  }
  return { settings };
}

function authHeaders(apiKey, projectId, idempotencyKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Chert-Project-Id': projectId,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

function getMessageState(message = {}) {
  return message?.state ??
    message?.send?.state ??
    message?.data?.state ??
    message?.data?.send?.state;
}

function classifyMessageState(state) {
  if (['sent', 'delivered', 'queued'].includes(state)) return 'sent';
  if (['failed', 'rejected', 'cancelled', 'undeliverable'].includes(state)) {
    return 'failed';
  }
  return 'unknown';
}

async function findExistingMessage(fetchImpl, settings, idempotencyKey) {
  const response = await fetchImpl(`${API_BASE}/shared-messages`, {
    headers: authHeaders(settings.apiKey, settings.projectId),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const messages = Array.isArray(data)
    ? data
    : data.messages ?? data.data?.messages ?? data.data ?? [];
  if (!Array.isArray(messages)) return null;
  return messages.find((message) =>
    message?.idempotency_key === idempotencyKey ||
    message?.idempotencyKey === idempotencyKey
  ) ?? null;
}

async function resolveMessageOutcome(fetchImpl, settings, idempotencyKey, body) {
  const state = classifyMessageState(getMessageState(body));
  if (state === 'sent') return { ok: true };
  if (state === 'failed') return { ok: false, error: 'Chert could not send the message' };

  const existing = await findExistingMessage(fetchImpl, settings, idempotencyKey);
  const existingState = classifyMessageState(getMessageState(existing));
  if (existingState === 'sent') return { ok: true };
  if (existingState === 'failed') return { ok: false, error: 'Chert could not send the message' };
  return { ok: false, error: 'Send outcome is unknown; inspect Chert before retrying' };
}

export function createTextSender({ fetchImpl = fetch, createKey = randomUUID } = {}) {
  return async function sendText({ phone, text } = {}) {
    const { settings, error } = getSettings(phone, text);
    if (error) return { ok: false, error };

    const idempotencyKey = `msg-${createKey()}`;
    let response;
    try {
      response = await fetchImpl(`${API_BASE}/shared-messages`, {
        method: 'POST',
        headers: {
          ...authHeaders(settings.apiKey, settings.projectId, idempotencyKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          line_id: settings.lineId,
          recipient: phone,
          text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      try {
        const existing = await findExistingMessage(fetchImpl, settings, idempotencyKey);
        if (classifyMessageState(getMessageState(existing)) === 'sent') {
          return { ok: true };
        }
      } catch {
        return { ok: false, error: 'Send outcome is unknown; inspect Chert before retrying' };
      }
      return { ok: false, error: 'Send outcome is unknown; inspect Chert before retrying' };
    }

    if (!response.ok) return { ok: false, error: `Chert rejected the message (HTTP ${response.status})` };

    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: 'Chert returned an unreadable message status' };
    }

    try {
      return await resolveMessageOutcome(fetchImpl, settings, idempotencyKey, body);
    } catch {
      return { ok: false, error: 'Send outcome is unknown; inspect Chert before retrying' };
    }
  };
}

export const sendText = createTextSender();
