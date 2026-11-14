// Kroger public API client for the Track C cart: app-token product search, the patient's stored sign-in, and the
// add-to-cart call. There is deliberately no checkout, order or payment call anywhere in this file. Nothing here
// throws, errors carry only short codes (never bodies, headers, tokens or the auth code), and importing has no side effects.
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KROGER_API = 'https://api.kroger.com/v1';
export const KROGER_CART_URL = 'https://www.kroger.com/cart';
export const MAX_QUANTITY = 5;
const DEFAULT_LOCATION_ID = '01100695';
const DEFAULT_REDIRECT_URI = 'http://localhost:8765/callback';
const USER_SCOPE = 'cart.basic:write';
const APP_SCOPE = 'product.compact';
const TOKEN_FILE = 'kroger-tokens.json';
const MAX_FILE_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 10_000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export function defaultTokenDir(env = process.env) {
  const custom = clean(env.KROGER_TOKEN_DIR);
  return custom ? resolve(custom) : join(homedir(), '.config', 'renal-dietitian');
}

export function readKrogerConfig(env = process.env) {
  const clientId = clean(env.KROGER_CLIENT_ID);
  const clientSecret = clean(env.KROGER_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    locationId: clean(env.KROGER_LOCATION_ID) || DEFAULT_LOCATION_ID,
    redirectUri: clean(env.KROGER_REDIRECT_URI) || DEFAULT_REDIRECT_URI,
    tokenDir: defaultTokenDir(env),
  };
}

export function parseQuantity(text) {
  const match = /^\s*(\d+)/.exec(typeof text === 'string' ? text : '');
  const n = match ? Number.parseInt(match[1], 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QUANTITY);
}

const MARKERS = /\b(?:unsalted|low[\s-]+sodium|no[\s-]+salt(?:[\s-]+added)?|reduced[\s-]+sodium|sodium[\s-]+free)\b/gi;

const stem = (word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
const words = (text) =>
  (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).map(stem);

function priceOf(product) {
  const price = product?.items?.[0]?.price;
  const promo = Number(price?.promo);
  if (Number.isFinite(promo) && promo > 0) return promo;
  const regular = Number(price?.regular);
  return Number.isFinite(regular) && regular > 0 ? regular : null;
}

export function chooseProduct(itemName, products) {
  if (typeof itemName !== 'string' || !Array.isArray(products)) return null;
  const wantsMarker = new RegExp(MARKERS.source, 'i').test(itemName);
  const needed = words(itemName.replace(MARKERS, ' '));
  if (needed.length === 0) return null;
  let best = null;
  for (const product of products) {
    const description = typeof product?.description === 'string' ? product.description : '';
    const unitPrice = priceOf(product);
    if (!description || typeof product.upc !== 'string' || unitPrice === null) continue;
    const have = new Set(words(description.replace(MARKERS, ' ')));
    if (!needed.every((w) => have.has(w))) continue;
    const hasMarker = new RegExp(MARKERS.source, 'i').test(description);
    if (wantsMarker && !hasMarker) continue;
    if (!best || (!wantsMarker && hasMarker && !best.hasMarker)) {
      best = { upc: product.upc, description, unitPrice, hasMarker };
    }
  }
  return best ? { upc: best.upc, description: best.description, unitPrice: best.unitPrice } : null;
}

// Product pictures are only ever fetched from Kroger's own picture path.
export function isKrogerImageUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:'
      && u.hostname === 'www.kroger.com'
      && u.port === ''
      && u.username === ''
      && u.password === ''
      && u.pathname.startsWith('/product/images/');
  } catch {
    return false;
  }
}

const SIZE_ORDER = ['large', 'medium', 'xlarge'];

export function pickImageUrl(product) {
  try {
    const images = Array.isArray(product?.images) ? product.images.filter((i) => i && typeof i === 'object') : [];
    const isFront = (i) => i.perspective === 'front';
    const isFeatured = (i) => i.featured === true;
    const ordered = [
      ...images.filter((i) => isFeatured(i) && isFront(i)),
      ...images.filter((i) => isFeatured(i) && !isFront(i)),
      ...images.filter((i) => !isFeatured(i) && isFront(i)),
      ...images.filter((i) => !isFeatured(i) && !isFront(i)),
    ];
    for (const image of ordered) {
      const sizes = Array.isArray(image.sizes) ? image.sizes.filter((s) => s && typeof s === 'object') : [];
      const rank = (s) => {
        const at = SIZE_ORDER.indexOf(s.size);
        return at === -1 ? SIZE_ORDER.length : at;
      };
      const sorted = sizes.map((s, at) => ({ s, at })).sort((a, b) => rank(a.s) - rank(b.s) || a.at - b.at);
      for (const { s } of sorted) {
        if (isKrogerImageUrl(s.url)) return s.url;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

const isInside = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export function createTokenStore({ dir } = {}) {
  const folder = resolve(dir ?? defaultTokenDir());
  const file = join(folder, TOKEN_FILE);

  async function folderOk() {
    try {
      if (isInside(REPO_ROOT, folder)) return false;
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const st = await lstat(folder);
      if (!st.isDirectory() || st.isSymbolicLink()) return false;
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
      if (isInside(REPO_ROOT, await realpath(folder))) return false;
      if ((st.mode & 0o777) !== 0o700) await chmod(folder, 0o700);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async load() {
      try {
        if (isInside(REPO_ROOT, folder)) return null;
        const st = await lstat(file);
        if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
        const data = JSON.parse(await readFile(file, 'utf8'));
        const token = data?.refreshToken;
        return typeof token === 'string' && token ? { refreshToken: token } : null;
      } catch {
        return null;
      }
    },
    async save({ refreshToken } = {}) {
      if (typeof refreshToken !== 'string' || !refreshToken) return { ok: false };
      if (!(await folderOk())) return { ok: false };
      const tmp = join(folder, `.kroger-tokens.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
      try {
        await writeFile(tmp, JSON.stringify({ refreshToken, savedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
        await rename(tmp, file);
        return { ok: true };
      } catch {
        try { await unlink(tmp); } catch { /* nothing to remove */ }
        return { ok: false };
      }
    },
  };
}

export function buildAuthorizeUrl({ clientId, redirectUri, state, scope = USER_SCOPE }) {
  const url = new URL(`${KROGER_API}/connect/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export function createKrogerClient({
  clientId,
  clientSecret,
  locationId = DEFAULT_LOCATION_ID,
  tokenStore,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let appToken = null;
  let appTokenExpires = 0;
  const basic = () => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

  // Returns { ok:true, status, body } or { ok:false, error }.
  async function request(url, init) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      return { ok: false, error: 'network' };
    }
    return { ok: true, response };
  }

  async function readJson(response) {
    try {
      const body = await response.json();
      return body && typeof body === 'object' ? { ok: true, body } : { ok: false, error: 'bad_response' };
    } catch {
      return { ok: false, error: 'bad_response' };
    }
  }

  async function tokenRequest(params) {
    const sent = await request(`${KROGER_API}/connect/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (!sent.ok) return sent;
    const { response } = sent;
    if (!response.ok) {
      const rejected = response.status === 400 || response.status === 401;
      return { ok: false, error: rejected ? 'sign_in_rejected' : `http_${response.status}`, rejectedStatus: rejected };
    }
    return readJson(response);
  }

  async function getAppToken() {
    if (appToken && now() < appTokenExpires) return { ok: true, token: appToken };
    const result = await tokenRequest({ grant_type: 'client_credentials', scope: APP_SCOPE });
    if (!result.ok) return { ok: false, error: result.error === 'sign_in_rejected' ? 'http_401' : result.error };
    const token = result.body.access_token;
    if (typeof token !== 'string' || !token) return { ok: false, error: 'bad_response' };
    const seconds = Number(result.body.expires_in);
    appToken = token;
    appTokenExpires = now() + (Number.isFinite(seconds) ? seconds : 0) * 1000 - 60_000;
    return { ok: true, token };
  }

  return {
    async searchProducts(term) {
      const auth = await getAppToken();
      if (!auth.ok) return { ok: false, error: auth.error };
      const url = new URL(`${KROGER_API}/products`);
      url.searchParams.set('filter.term', String(term));
      url.searchParams.set('filter.locationId', locationId);
      url.searchParams.set('filter.limit', '10');
      const sent = await request(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
      });
      if (!sent.ok) return sent;
      if (!sent.response.ok) return { ok: false, error: `http_${sent.response.status}` };
      const json = await readJson(sent.response);
      if (!json.ok) return json;
      return { ok: true, products: Array.isArray(json.body.data) ? json.body.data : [] };
    },

    async getUserToken() {
      const stored = await tokenStore.load();
      if (!stored?.refreshToken) return { ok: false, error: 'no_sign_in' };
      const result = await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refreshToken });
      if (!result.ok) return { ok: false, error: result.error };
      const token = result.body.access_token;
      if (typeof token !== 'string' || !token) return { ok: false, error: 'bad_response' };
      const rotated = result.body.refresh_token;
      if (typeof rotated === 'string' && rotated && rotated !== stored.refreshToken) {
        await tokenStore.save({ refreshToken: rotated });
      }
      return { ok: true, token };
    },

    async addToCart({ upc, quantity }, userToken) {
      const sent = await request(`${KROGER_API}/cart/add`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ upc, quantity, modality: 'PICKUP' }] }),
      });
      if (!sent.ok) return sent;
      const { status } = sent.response;
      if (sent.response.ok) return { ok: true };
      return { ok: false, error: status === 401 ? 'sign_in_rejected' : `http_${status}` };
    },

    async exchangeCode({ code, redirectUri }) {
      const result = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if (!result.ok) return { ok: false, error: result.error };
      const refresh = result.body.refresh_token;
      if (typeof refresh !== 'string' || !refresh) return { ok: false, error: 'bad_response' };
      const saved = await tokenStore.save({ refreshToken: refresh });
      return saved.ok ? { ok: true } : { ok: false, error: 'bad_response' };
    },
  };
}
