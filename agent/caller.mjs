// Who is calling? Pure apart from the injected lookup. Never throws.
// The phone number lives only in memory for this call: never write it to disk, never log it or the derived id.
import { createHash, randomBytes } from 'node:crypto';

const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const BRIDGE_PREFIX = 'chert-bridge-';

const validId = (v) => (typeof v === 'string' && CALL_ID.test(v) ? v : null);

export function callIdFrom({ identity, roomMetadata, jobMetadata } = {}) {
  try {
    if (typeof identity === 'string' && identity.startsWith(BRIDGE_PREFIX)) {
      const id = validId(identity.slice(BRIDGE_PREFIX.length));
      if (id) return id;
    }
    let room = roomMetadata;
    if (typeof room === 'string') {
      try { room = JSON.parse(room); } catch { room = null; }
    }
    const fromRoom = validId(room?.chert_call);
    if (fromRoom) return fromRoom;
    return validId(jobMetadata?.chert_call);
  } catch {
    return null;
  }
}

export function patientIdFor(phone) {
  return 'p' + createHash('sha256').update(phone).digest('hex').slice(0, 24);
}

export async function resolveCaller({
  outbound,
  identity,
  roomMetadata,
  jobMetadata,
  env = process.env,
  getCallerPhone,
  timeoutMs = 1500,
  randomHex = () => randomBytes(12).toString('hex'),
} = {}) {
  const demo = { kind: 'demo', patientId: 'demo', phone: env.PATIENT_PHONE, textAllow: null, textFirst: false };
  // Flag off (default) or an outbound call: today's behaviour, and no Chert lookup at all.
  if (env.AGENT_OPEN_ACCESS !== '1' || outbound) return demo;

  // With open access on, a failed lookup gets an isolated one-call guest, never the demo patient's data.
  const guest = () => ({ kind: 'guest', patientId: 'g' + randomHex(), phone: null, textAllow: null, textFirst: false });
  const callId = callIdFrom({ identity, roomMetadata, jobMetadata });
  if (!callId || typeof getCallerPhone !== 'function') return guest();

  let timer;
  try {
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const r = await Promise.race([Promise.resolve().then(() => getCallerPhone({ callId })), late]);
    const phone = r?.ok === true ? r.phone : null;
    if (typeof phone !== 'string' || !E164.test(phone)) return guest();
    if (phone === env.PATIENT_PHONE) return demo;
    return { kind: 'caller', patientId: patientIdFor(phone), phone, textAllow: phone, textFirst: true };
  } catch {
    return guest();
  } finally {
    clearTimeout(timer);
  }
}
