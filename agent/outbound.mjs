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
