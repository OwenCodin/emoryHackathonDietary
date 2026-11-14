// Outbound calls (twist 3): Track C's callPatient dispatches the agent with JSON job metadata
// {"outbound": true, "reason": "...", "bridgeIdentity": "chert-bridge-out-..."}.
// Pure helpers, no imports. Metadata comes from whoever can create a dispatch, so it is validated strictly.

const MAX_METADATA_CHARS = 4096;
const BRIDGE_IDENTITY = /^chert-bridge-[A-Za-z0-9_-]{1,100}$/;

// Never throws: anything that is not a JSON object gives {}.
export function parseJobMetadata(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_METADATA_CHARS) return {};
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Lowercase letters, digits and underscores only, at most 40 characters: safe to put in a log line.
export function safeReason(value) {
  if (typeof value !== 'string') return 'unspecified';
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
  return cleaned || 'unspecified';
}

// { bridgeIdentity, reason } for a well-formed outbound request, otherwise null (inbound path).
export function outboundCall(metadata) {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  if (metadata.outbound !== true) return null;
  if (typeof metadata.bridgeIdentity !== 'string' || !BRIDGE_IDENTITY.test(metadata.bridgeIdentity)) return null;
  return { bridgeIdentity: metadata.bridgeIdentity, reason: safeReason(metadata.reason) };
}

// True when the metadata asks for an outbound call, well formed or not. With outboundCall() null this means
// the request was malformed and must not quietly become an inbound call.
export function outboundRequested(metadata) {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.outbound === true;
}

const DEFAULT_WAIT_SECONDS = 90;
const MAX_WAIT_SECONDS = 600;

// How long an outbound job waits for the patient to answer, in milliseconds. Default 90 seconds (Chert rings for
// up to 45 more after callPatient's 15 second agent wait). AGENT_OUTBOUND_WAIT_SECONDS overrides it for testing only;
// it is deliberately not part of the shared env contract. Anything not a positive number gives the default.
export function outboundWaitMs(raw) {
  const seconds = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_WAIT_SECONDS * 1000;
  return Math.min(seconds, MAX_WAIT_SECONDS) * 1000;
}

// One restartable deadline. arm() starts or restarts it, clear() stops it for good; onExpire runs at most once.
// Timer functions are injectable so this is unit tested without waiting.
export function createDeadline({ ms, onExpire, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let handle = null, closed = false;
  const stop = () => { if (handle !== null) { clearTimer(handle); handle = null; } };
  return {
    arm() {
      if (closed) return;
      stop();
      handle = setTimer(() => { handle = null; if (closed) return; closed = true; onExpire(); }, ms);
      if (typeof handle?.unref === 'function') handle.unref();
    },
    clear() { closed = true; stop(); },
  };
}
