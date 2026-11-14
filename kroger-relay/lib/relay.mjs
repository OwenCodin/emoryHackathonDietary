// Kroger sign-in relay. Dependency-free Web handlers: start, callback, claim.
// Holds NO Kroger client secret and NO token: only the one-time authorization code, keyed by the state,
// for at most CODE_TTL_MS. The agent's Mac claims it with a shared secret and exchanges it locally.
import { createHash, timingSafeEqual } from 'node:crypto';

export const CODE_TTL_MS = 600_000;
const AUTHORIZE_URL = 'https://api.kroger.com/v1/connect/oauth2/authorize';
const SCOPE = 'cart.basic:write';
const MAX_CODE = 2048;
const MAX_CLAIM_BODY = 1024;

export const isValidState = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// lines[0] is the heading; the rest are paragraphs (already HTML-safe).
function page(status, lines) {
  const body = lines.map((l, i) => (i === 0 ? `<h1>${l}</h1>` : `<p>${l}</p>`)).join('');
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Kroger sign-in</title>' +
    '<style>body{font-family:system-ui,sans-serif;font-size:22px;line-height:1.4;margin:2rem;max-width:32rem}h1{font-size:28px}</style>' +
    `</head><body>${body}</body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const NOT_VALID = ['This sign-in link is not valid.', 'Go back to your call and ask for a new link.'];
const COULD_NOT_SAVE = ["We couldn't save your Kroger sign-in.", 'Go back to your call and ask for a new link.'];

function sameSecret(given, expected) {
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function baseUrl(request, env) {
  const configured = String(env.RELAY_PUBLIC_URL ?? '').replace(/\/+$/, '');
  return configured || new URL(request.url).origin;
}

// The rewrite /k/:state -> /api/k?state=:state should pass the state in the query; fall back to the path.
function stateFromRequest(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('state');
  if (q !== null) return q;
  if (url.pathname.startsWith('/k/')) return url.pathname.slice(3);
  return null;
}

export function createRelay({ store, env = process.env, now = Date.now }) {
  const wrap = (fallback) => (fn) => async (request) => {
    try {
      return await fn(request);
    } catch {
      return fallback();
    }
  };
  const asPage = wrap(() => page(500, ['Something went wrong.', 'Go back to your call and ask for a new link.']));
  const asJson = wrap(() => json(500, { error: 'server_error' }));

  const start = asPage(async (request) => {
    const clientId = env.KROGER_CLIENT_ID;
    if (!clientId) return page(503, ['Kroger sign-in is not set up yet.']);
    const state = stateFromRequest(request);
    if (!isValidState(state)) return page(400, NOT_VALID);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `${baseUrl(request, env)}/api/kroger/callback`,
      scope: SCOPE,
      state,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${AUTHORIZE_URL}?${params.toString()}`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  });

  const callback = asPage(async (request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error !== null) {
      return page(400, [
        'Kroger sign-in was not finished.',
        escapeHtml(error.slice(0, 40)),
        'Go back to your call and ask for a new link.',
      ]);
    }
    if (!isValidState(state)) return page(400, NOT_VALID);
    const code = url.searchParams.get('code');
    if (!code || code.length > MAX_CODE || !/^[\x21-\x7e]+$/.test(code)) return page(400, NOT_VALID);
    const put = await store.put(state, { code, at: now() });
    if (!put.ok && !put.exists) return page(503, COULD_NOT_SAVE);
    try {
      await store.sweep(now() - CODE_TTL_MS);
    } catch {
      // a failed sweep never changes the page
    }
    return page(200, [
      "Thanks, you're signed in to Kroger.",
      "If you're still on your call, go back to it. If your call has ended, call your dietitian back within a few minutes to finish connecting.",
      'After ten minutes this sign-in is dropped, and you can ask for a new link on any call.',
      'You can close this page.',
    ]);
  });

  const claim = asJson(async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const secret = env.RELAY_SECRET;
    if (!secret || String(secret).length < 32) return json(503, { error: 'not_configured' });
    const authHeader = request.headers.get('authorization') ?? '';
    const given = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!sameSecret(given, secret)) return json(401, { error: 'unauthorized' });
    const text = await request.text();
    if (text.length > MAX_CLAIM_BODY) return json(400, { error: 'bad_request' });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const state = body?.state;
    if (!isValidState(state)) return json(400, { error: 'bad_request' });
    const record = await store.get(state);
    if (!record) return json(404, { error: 'not_found' });
    await store.del(state);
    if (now() - record.at > CODE_TTL_MS) return json(404, { error: 'not_found' });
    return json(200, { code: record.code });
  });

  return { start, callback, claim };
}
