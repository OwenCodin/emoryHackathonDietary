import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach, beforeEach } from 'node:test';

const stateDir = await mkdtemp(join(tmpdir(), 'renal-lookup-state-'));
process.env.RENAL_STATE_DIR = stateDir;
const { lookupFood } = await import('./nutrients.mjs');

after(async () => {
  delete process.env.RENAL_STATE_DIR;
  await rm(stateDir, { recursive: true, force: true });
});

const saved = {};
let fetchCalls = 0;
beforeEach(() => {
  saved.fetch = globalThis.fetch;
  saved.usda = process.env.USDA_API_KEY;
  saved.google = process.env.GOOGLE_API_KEY;
  delete process.env.USDA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be used');
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  if (saved.usda === undefined) delete process.env.USDA_API_KEY;
  else process.env.USDA_API_KEY = saved.usda;
  if (saved.google === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = saved.google;
});

test('generic fallback: a brand-qualified lettuce resolves to the lettuce seed with no network', async () => {
  const result = await lookupFood({ name: 'Local Bounti Crispy Green Leaf lettuce' });
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.matched, 'seed');
  assert.equal(result.name, 'lettuce');
  assert.equal(result.genericFrom, 'Local Bounti Crispy Green Leaf lettuce');
  assert.equal(fetchCalls, 0);
});

test('generic fallback: plural forms resolve', async () => {
  const result = await lookupFood({ name: 'crisp iceberg lettuces' });
  assert.equal(result.found, true);
  assert.equal(result.name, 'lettuce');
});

test('generic fallback: unknown multi-word names do not match a seed', async () => {
  const result = await lookupFood({ name: 'Local Bounti Spring Mix' });
  assert.deepEqual({ ok: result.ok, found: result.found }, { ok: true, found: false });
});

test('generic fallback never reduces risky or compound names', async () => {
  for (const name of ['pina colada', 'coconut water', 'chocolate milk', 'smoked salmon', 'oat milk', 'banana milk', 'star fruit juice', 'canned tomato soup']) {
    const result = await lookupFood({ name });
    assert.equal(result.found, false, name);
    assert.equal(result.genericFrom, undefined, name);
  }
});

test('generic fallback: a single unknown word has no generic step', async () => {
  const result = await lookupFood({ name: 'zzyzx' });
  assert.equal(result.found, false);
});

// ---- Chain, web step and cache (Task 2) ----
const { readFile, writeFile } = await import('node:fs/promises');
const cachePath = join(stateDir, 'cache.json');

const OATLY = `I found this on the Oatly website.
PRODUCT: Oatly Oat Milk
SERVING: 1 cup (240 ml)
SERVING_AMOUNT: 240 ml
SODIUM_MG: 100
POTASSIUM_MG: 390
PHOSPHORUS_MG: 270
PHOSPHATE_ADDITIVE: no`;

const groundedResponse = (text) => ({
  text,
  candidates: [{
    groundingMetadata: {
      webSearchQueries: ['q'],
      groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/x', title: 'oatly.com' } }],
    },
  }],
});
const ungroundedResponse = (text) => ({ text, candidates: [{ groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [] } }] });

function fakeAi(responder) {
  const calls = [];
  return { calls, models: { generateContent: async (params) => { calls.push(params); return responder(params); } } };
}

const SEEDED_WEB = {
  kind: 'web',
  name: 'Seeded Web Snack',
  query: 'seeded web snack',
  servingText: '1 bar (40 g)',
  servingAmount: 40,
  servingUnit: 'g',
  nutrients: { sodiumMg: 80, potassiumMg: 120, phosphorusMg: 60 },
  phosphateAdditive: false,
  host: 'example.com',
  waterMl: null,
};
// The in-process cache loads once, so write cache.json before any lookup that needs it.
await writeFile(cachePath, JSON.stringify({
  foods: {},
  web: {
    'seeded web snack': SEEDED_WEB,
    'tampered web snack': { ...SEEDED_WEB, name: 'Tampered Web Snack', nutrients: { sodiumMg: 90000, potassiumMg: 1, phosphorusMg: 1 } },
    'mismatch web snack': { ...SEEDED_WEB, name: 'Totally Different Cereal' },
  },
}));

function usdaStub(handler) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url).searchParams.get('query'));
    return handler(url);
  };
  return calls;
}
const status = (code) => async () => ({ ok: false, status: code, json: async () => ({}) });

test('acceptance A: USDA 429 then a grounded valid answer is found as web', async () => {
  process.env.USDA_API_KEY = 'k';
  const usdaCalls = usdaStub(status(429));
  const ai = fakeAi(() => groundedResponse(OATLY));
  const result = await lookupFood({ name: 'oatly oat milk' }, { ai });
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.source, 'web');
  assert.equal(result.matched, 'web');
  assert.equal(result.servingText, '1 cup (240 ml)');
  assert.equal(result.host, 'oatly.com');
  assert.equal(usdaCalls.length, 1);
});

test('acceptance B: USDA 429 and an ungrounded answer is not found, never ok:false', async () => {
  process.env.USDA_API_KEY = 'k';
  usdaStub(status(429));
  const result = await lookupFood({ name: 'oatly barista edition' }, { ai: fakeAi(() => ungroundedResponse(OATLY)) });
  assert.deepEqual(result, { ok: true, found: false });
});

test('acceptance C: a grounded answer with sodium 50000 is not found', async () => {
  process.env.USDA_API_KEY = 'k';
  usdaStub(status(429));
  const text = OATLY.replace('SODIUM_MG: 100', 'SODIUM_MG: 50000');
  const result = await lookupFood({ name: 'oatly oat milk extra' }, { ai: fakeAi(() => groundedResponse(text)) });
  assert.deepEqual(result, { ok: true, found: false });
});

test('acceptance D: a grounded answer for a different product is not found', async () => {
  process.env.USDA_API_KEY = 'k';
  usdaStub(status(429));
  const text = OATLY.replace('Oatly Oat Milk', 'Minute Maid Lemonade');
  const result = await lookupFood({ name: 'coca cola zero cherry' }, { ai: fakeAi(() => groundedResponse(text)) });
  assert.deepEqual(result, { ok: true, found: false });
});

test('every kind of USDA failure falls through to the web lookup', async () => {
  process.env.USDA_API_KEY = 'k';
  const handlers = {
    '503': status(503),
    throws: async () => { throw new Error('timeout'); },
    badjson: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
  };
  let n = 0;
  for (const [label, handler] of Object.entries(handlers)) {
    usdaStub(handler);
    n += 1;
    const ai = fakeAi(() => groundedResponse(OATLY.replace('Oatly Oat Milk', `Oatly Oat Milk Fall${'x'.repeat(n)}`)));
    const result = await lookupFood({ name: `oatly oat milk fall${'x'.repeat(n)}` }, { ai });
    assert.equal(result.found, true, label);
    assert.equal(result.source, 'web', label);
  }
  delete process.env.USDA_API_KEY;
  const ai = fakeAi(() => groundedResponse(OATLY.replace('Oatly Oat Milk', 'Oatly Oat Milk Nokey')));
  const result = await lookupFood({ name: 'oatly oat milk nokey' }, { ai });
  assert.equal(result.source, 'web');
});

test('a USDA failure is never cached as not-found', async () => {
  process.env.USDA_API_KEY = 'k';
  usdaStub(status(429));
  const first = await lookupFood({ name: 'zesty bean paste' }, { ai: fakeAi(() => ungroundedResponse('nothing')) });
  assert.deepEqual(first, { ok: true, found: false });
  usdaStub(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ foods: [{
      description: 'Zesty bean paste, canned',
      fdcId: 7,
      foodNutrients: [{ nutrientId: 1093, value: 300 }, { nutrientId: 1092, value: 200 }, { nutrientId: 1091, value: 50 }],
    }] }),
  }));
  const second = await lookupFood({ name: 'zesty bean paste' }, { ai: fakeAi(() => assert.fail('web must not be used')) });
  assert.equal(second.found, true);
  assert.equal(second.source, 'usda');
  assert.equal(second.matched, 'usda');
});

test('an accepted web result is cached on disk and served without calling the model', async () => {
  delete process.env.USDA_API_KEY;
  const ai = fakeAi(() => groundedResponse(OATLY.replace('Oatly Oat Milk', 'Oatly Oat Milk Cached')));
  const first = await lookupFood({ name: 'oatly oat milk cached' }, { ai });
  assert.equal(first.found, true);
  assert.equal(ai.calls.length, 1);
  const onDisk = JSON.parse(await readFile(cachePath, 'utf8'));
  assert.equal(onDisk.web['oatly oat milk cached'].kind, 'web');
  assert.equal(typeof onDisk.web['oatly oat milk cached'].savedAt, 'string');
  const second = await lookupFood({ name: 'Oatly Oat Milk Cached' }, { ai: fakeAi(() => assert.fail('cache must be used')) });
  assert.equal(second.source, 'web');
  assert.deepEqual(second.nutrients, first.nutrients);
});

test('a pre-seeded valid web cache entry is served; tampered and mismatched entries are ignored', async () => {
  delete process.env.USDA_API_KEY;
  const ok = await lookupFood({ name: 'seeded web snack' }, { ai: fakeAi(() => assert.fail('cache must be used')) });
  assert.equal(ok.source, 'web');
  assert.equal(ok.host, 'example.com');

  for (const name of ['tampered web snack', 'mismatch web snack']) {
    const ai = fakeAi(() => ungroundedResponse('nothing'));
    const result = await lookupFood({ name }, { ai });
    assert.deepEqual(result, { ok: true, found: false }, name);
    assert.equal(ai.calls.length, 1, name);
  }
});

test('a web rejection is negatively cached in memory only', async () => {
  delete process.env.USDA_API_KEY;
  const ai = fakeAi(() => ungroundedResponse(OATLY));
  await lookupFood({ name: 'rejected oat drink' }, { ai });
  await lookupFood({ name: 'rejected oat drink' }, { ai });
  assert.equal(ai.calls.length, 1);
  const onDisk = JSON.parse(await readFile(cachePath, 'utf8'));
  assert.equal(onDisk.web?.['rejected oat drink'], undefined);
  assert.equal(onDisk.foods?.['rejected oat drink'], undefined);
});
