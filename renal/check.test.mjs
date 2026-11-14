import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach, beforeEach } from 'node:test';
import { checkFood, numberWords } from './check.mjs';
import { plausibleMatch } from './nutrients.mjs';

const stateDir = await mkdtemp(join(tmpdir(), 'renal-check-state-'));
process.env.RENAL_STATE_DIR = stateDir;
after(async () => {
  delete process.env.RENAL_STATE_DIR;
  await rm(stateDir, { recursive: true, force: true });
});

const profile = {
  id: 'demo',
  name: 'Sam',
  limits: { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
  avoid: ['star fruit', 'salt substitute'],
  setBy: 'care team',
};

const saved = {};
beforeEach(() => {
  saved.fetch = globalThis.fetch;
  saved.usda = process.env.USDA_API_KEY;
  saved.google = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.USDA_API_KEY;
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  if (saved.usda === undefined) delete process.env.USDA_API_KEY;
  else process.env.USDA_API_KEY = saved.usda;
  if (saved.google === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = saved.google;
});

function usdaFetch(foodsByQuery) {
  const calls = [];
  const stub = async (url) => {
    const query = new URL(url).searchParams.get('query');
    calls.push(query);
    const foods = typeof foodsByQuery === 'function' ? foodsByQuery(query) : foodsByQuery;
    return { ok: true, status: 200, json: async () => ({ foods }) };
  };
  stub.calls = calls;
  return stub;
}

function failIfCalled() {
  return async () => {
    assert.fail('network must not be used');
  };
}

function hit(description, fdcId, potassium, sodium, phosphorus) {
  return {
    description,
    fdcId,
    foodNutrients: [
      { nutrientId: 1092, value: potassium },
      { nutrientId: 1093, value: sodium },
      { nutrientId: 1091, value: phosphorus },
    ],
  };
}

test('numberWords is total and non-recursive for bad input', () => {
  assert.equal(numberWords(NaN), null);
  assert.equal(numberWords(Infinity), null);
  assert.equal(numberWords(-Infinity), null);
  assert.equal(numberWords(-5), 'zero');
  assert.equal(numberWords(1e12), '1000000000000');
  assert.equal(numberWords(422), 'four hundred twenty two');
  assert.equal(numberWords(2000), 'two thousand');
});

test('a USDA food without a serving size is judged per 100 g without crashing', async () => {
  process.env.USDA_API_KEY = 'test-key';
  globalThis.fetch = usdaFetch([hit('Plantains, yellow, raw', 1, 499, 4, 34)]);
  const result = await checkFood({ food: { name: 'plantain', grams: null }, profile });
  assert.equal(result.ok, true);
  assert.equal(result.nutrients.potassiumMg, 499);
  assert.equal(result.nutrients.sodiumMg, 4);
  assert.match(result.portion, /100 g/);
  assert.doesNotMatch(result.say, /NaN|undefined|null/);
  assert.match(result.say, /100 grams/);
  assert.equal(result.source, 'usda');
});

test('a non-finite USDA nutrient becomes unknown instead of being spoken', async () => {
  process.env.USDA_API_KEY = 'test-key';
  globalThis.fetch = usdaFetch([hit('Breadfruit, raw', 2, null, null, null)]);
  const result = await checkFood({ food: { name: 'breadfruit' }, profile });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.nutrients?.potassiumMg ?? null, null);
  assert.doesNotMatch(result.say, /NaN/);
});

test('seeded banana and star fruit keep their verdicts', async () => {
  globalThis.fetch = failIfCalled();
  const banana = await checkFood({ food: { name: 'banana' }, profile });
  assert.equal(banana.verdict, 'limit');
  assert.equal(banana.nutrients.potassiumMg, 422);
  const star = await checkFood({ food: { name: 'star fruit' }, profile });
  assert.equal(star.verdict, 'avoid');
});

test('cola brands resolve to the curated seed with the phosphate reason and no network', async () => {
  process.env.USDA_API_KEY = 'test-key';
  globalThis.fetch = failIfCalled();
  for (const name of ['Coca-Cola', 'coca cola', 'coke', 'pepsi', 'diet coke', 'cola', 'soda']) {
    const result = await checkFood({ food: { name }, profile });
    assert.equal(result.ok, true, name);
    assert.equal(result.verdict, 'limit', name);
    assert.match(result.reasons.join(' '), /phosphate additive/i, name);
    assert.equal(result.nutrients.phosphorusMg, 60, name);
    assert.match(result.say, /phosphate additive/i, name);
  }
});

test('an implausible USDA hit is rejected and never cached as a positive', async () => {
  process.env.USDA_API_KEY = 'test-key';
  globalThis.fetch = usdaFetch([hit('Beverages, water, bottled, non-carbonated, PEPSI, AQUAFINA', 3, 0, 2, 0)]);
  const result = await checkFood({ food: { name: 'pepsi max' }, profile });
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.nutrients, null);
  assert.equal(result.source, 'none');
  assert.match(result.say, /cannot judge/);
  assert.doesNotMatch(result.say, /\d/);
  const again = await checkFood({ food: { name: 'pepsi max' }, profile });
  assert.equal(again.verdict, 'unknown');
  assert.equal(again.nutrients, null);
});

test('the first credible USDA candidate wins', async () => {
  process.env.USDA_API_KEY = 'test-key';
  globalThis.fetch = usdaFetch([
    hit('Beverages, The COCA-COLA company, Minute Maid, Lemonade', 4, 10, 5, 5),
    hit('Plantains, green, raw', 5, 499, 4, 34),
  ]);
  const result = await checkFood({ food: { name: 'green plantains' }, profile });
  assert.equal(result.ok, true);
  assert.equal(result.nutrients.potassiumMg, 499);
});

test('plausibleMatch compares whole significant words', () => {
  assert.equal(plausibleMatch('pepsi max', 'Beverages, water, bottled, non-carbonated, PEPSI, AQUAFINA'), false);
  assert.equal(plausibleMatch('plantain', 'Plantains, yellow, raw'), true);
  assert.equal(plausibleMatch('dragon fruit', 'Kiwifruit, green, raw'), false);
  assert.equal(plausibleMatch('the', 'The thing'), false);
});

test('hard avoid rules match whole phrases inside the name', async () => {
  globalThis.fetch = failIfCalled();
  assert.equal((await checkFood({ food: { name: 'star fruit juice' }, profile })).verdict, 'avoid');
  assert.equal((await checkFood({ food: { name: 'star fruit' }, profile })).verdict, 'avoid');
  assert.equal((await checkFood({ food: { name: 'banana' }, profile })).verdict, 'limit');
});

test('cola rule matches phrases but not look-alike words', async () => {
  globalThis.fetch = usdaFetch([]);
  const cherry = await checkFood({ food: { name: 'cherry cola' }, profile });
  assert.equal(cherry.verdict, 'limit');
  assert.match(cherry.reasons.join(' '), /phosphate additive/i);
  const colada = await checkFood({ food: { name: 'pina colada' }, profile });
  assert.equal(colada.verdict, 'unknown');
});

const emptyLabel = (product, ingredients = null) => ({
  product,
  servingSize: null,
  sodiumMg: null,
  potassiumMg: null,
  phosphorusMg: null,
  ingredients,
});

test('a numberless Coca-Cola label is judged by the product name', async () => {
  process.env.USDA_API_KEY = 'test-key';
  globalThis.fetch = failIfCalled();
  const result = await checkFood({ food: { name: 'Coca-Cola', label: emptyLabel('Coca-Cola') }, profile });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'limit');
  assert.equal(result.source, 'rule');
  assert.match(result.reasons.join(' '), /phosphate additive/i);
});

test('a numberless label with no known product still applies ingredient rules', async () => {
  globalThis.fetch = usdaFetch([]);
  const withPhos = await checkFood({
    food: { name: 'Mystery fizz', label: emptyLabel('Mystery fizz', 'water, sugar, phosphoric acid') },
    profile,
  });
  assert.equal(withPhos.verdict, 'limit');
  assert.match(withPhos.reasons.join(' '), /phosphate additive/i);
  const none = await checkFood({ food: { name: 'Mystery bar', label: emptyLabel('Mystery bar') }, profile });
  assert.equal(none.verdict, 'unknown');
  assert.equal(none.nutrients, null);
  assert.match(none.say, /cannot judge/);
});

test('a label with numbers keeps using its own numbers', async () => {
  globalThis.fetch = failIfCalled();
  const result = await checkFood({
    food: {
      name: 'Chicken broth',
      label: { ...emptyLabel('Chicken broth', 'chicken stock, salt'), servingSize: '1 cup', sodiumMg: 860 },
    },
    profile,
  });
  assert.equal(result.verdict, 'avoid');
  assert.equal(result.source, 'label');
  assert.equal(result.nutrients.sodiumMg, 860);
});

// ---- Web results and generic seed matches ----
const OATLY_ANSWER = `I found this on the Oatly website.
PRODUCT: Oatly Oat Milk
SERVING: 1 cup (240 ml)
SERVING_AMOUNT: 240 ml
SODIUM_MG: 100
POTASSIUM_MG: 390
PHOSPHORUS_MG: 270
PHOSPHATE_ADDITIVE: no`;

function webAi(text, calls = []) {
  return {
    calls,
    models: {
      generateContent: async (params) => {
        calls.push(params);
        return {
          text,
          candidates: [{
            groundingMetadata: {
              webSearchQueries: ['q'],
              groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/x', title: 'oatly.com' } }],
            },
          }],
        };
      },
    },
  };
}
const ungroundedAi = (calls = []) => ({
  calls,
  models: {
    generateContent: async (params) => {
      calls.push(params);
      return { text: OATLY_ANSWER, candidates: [{ groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [] } }] };
    },
  },
});
const PROVENANCE = "That is from what I found online, not from your care team's list.";
const sentences = (say) => say.split(/(?<=\.)\s+/);
const answerFor = (product, fields = {}) => {
  let text = OATLY_ANSWER.replace('Oatly Oat Milk', product);
  for (const [key, value] of Object.entries(fields)) text = text.replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`);
  return text;
};

test('web result: judged per found serving with source web and the online provenance', async () => {
  const result = await checkFood({ food: { name: 'oatly oat milk web a' }, profile }, { ai: webAi(answerFor('Oatly Oat Milk Web A')) });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'web');
  assert.equal(result.portion, '1 cup (240 ml)');
  assert.deepEqual(result.nutrients, { sodiumMg: 100, potassiumMg: 390, phosphorusMg: 270 });
  assert.equal(result.verdict, 'avoid');
  assert.match(result.reasons.join(' '), /nutrition found online \(oatly\.com\), per 1 cup \(240 ml\)/);
  assert.match(result.reasons.join(' '), /counts toward the fluid limit/);
  const parts = sentences(result.say);
  assert.equal(parts.length, 2);
  assert.equal(parts[1], PROVENANCE);
  assert.match(parts[0], /^Avoid, oatly oat milk web a has about two hundred seventy milligrams of phosphorus per serving; try an unseasoned fresh alternative instead\.$/);
});

test('web result with unknown phosphorus never implies phosphorus is fine', async () => {
  const text = answerFor('Oatly Oat Milk Web B', { PHOSPHORUS_MG: 'unknown', PHOSPHATE_ADDITIVE: 'unknown', POTASSIUM_MG: '40', SODIUM_MG: '30' });
  const result = await checkFood({ food: { name: 'oatly oat milk web b' }, profile }, { ai: webAi(text) });
  assert.equal(result.verdict, 'ok');
  assert.equal(result.nutrients.phosphorusMg, null);
  assert.match(result.say, /I could not find its phosphorus/);
  assert.equal(sentences(result.say).length, 2);
  assert.ok(result.say.endsWith(PROVENANCE));
});

test('web result with a phosphate additive is raised to limit and says so', async () => {
  const text = answerFor('Oatly Oat Milk Web C', { PHOSPHORUS_MG: '10', PHOSPHATE_ADDITIVE: 'yes', POTASSIUM_MG: '40', SODIUM_MG: '30' });
  const result = await checkFood({ food: { name: 'oatly oat milk web c' }, profile }, { ai: webAi(text) });
  assert.equal(result.verdict, 'limit');
  assert.equal(result.source, 'web');
  assert.match(result.reasons.join(' '), /phosphate additive/);
  assert.match(result.say, /phosphate additive/);
  assert.ok(result.say.endsWith(PROVENANCE));
});

test('cola rule still raises an ok web cola to limit but the source stays web', async () => {
  const text = `Found on a site.
PRODUCT: Cola Zero Web
SERVING: 1 can (355 ml)
SERVING_AMOUNT: 355 ml
SODIUM_MG: 30
POTASSIUM_MG: 10
PHOSPHORUS_MG: 20
PHOSPHATE_ADDITIVE: unknown`;
  const result = await checkFood({ food: { name: 'cola zero web' }, profile }, { ai: webAi(text) });
  assert.equal(result.verdict, 'limit');
  assert.equal(result.source, 'web');
  assert.match(result.reasons.join(' '), /phosphate additives/);
  assert.ok(result.say.endsWith(PROVENANCE));
});

test('web result scales by grams over the found serving amount', async () => {
  const result = await checkFood({ food: { name: 'oatly oat milk web d', grams: 480 }, profile }, { ai: webAi(answerFor('Oatly Oat Milk Web D')) });
  assert.deepEqual(result.nutrients, { sodiumMg: 200, potassiumMg: 780, phosphorusMg: 540 });
  assert.equal(result.portion, '480 g (online serving: 1 cup (240 ml))');
  assert.doesNotMatch(result.say, /per serving/);
});

test('web result without a known serving amount is not rescaled', async () => {
  const text = answerFor('Oatly Oat Milk Web E', { SERVING_AMOUNT: 'unknown' });
  const result = await checkFood({ food: { name: 'oatly oat milk web e', grams: 100 }, profile }, { ai: webAi(text) });
  assert.deepEqual(result.nutrients, { sodiumMg: 100, potassiumMg: 390, phosphorusMg: 270 });
  assert.match(result.portion, /online serving; your amount was not converted/);
});

test('acceptance F: a brand-qualified lettuce is judged as lettuce with no network', async () => {
  process.env.USDA_API_KEY = 'k';
  globalThis.fetch = failIfCalled();
  const ai = { models: { generateContent: async () => assert.fail('ai must not be used') } };
  const result = await checkFood({ food: { name: 'Local Bounti Crispy Green Leaf lettuce' }, profile }, { ai });
  assert.equal(result.ok, true);
  assert.notEqual(result.verdict, 'unknown');
  assert.equal(result.source, 'usda');
  assert.match(result.reasons.join(' '), /judged as lettuce/);
  assert.match(result.portion, /judged as lettuce/);
});

test('acceptance F: an unmatched brand mix with USDA 429 and no grounding is unknown', async () => {
  process.env.USDA_API_KEY = 'k';
  let usdaCalls = 0;
  globalThis.fetch = async () => {
    usdaCalls += 1;
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const aiCalls = [];
  const result = await checkFood({ food: { name: 'Local Bounti Spring Mix' }, profile }, { ai: ungroundedAi(aiCalls) });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.source, 'none');
  assert.equal(result.say, 'I do not have reliable nutrition numbers for Local Bounti Spring Mix, so I cannot judge it yet.');
  assert.equal(usdaCalls, 1);
  assert.equal(aiCalls.length, 1);
});

test('acceptance F: pina colada is never judged as cola', async () => {
  globalThis.fetch = failIfCalled();
  const result = await checkFood({ food: { name: 'pina colada' }, profile }, { ai: ungroundedAi() });
  assert.equal(result.verdict, 'unknown');
  assert.doesNotMatch(result.reasons.join(' '), /cola|phosphate/i);
  assert.notEqual(result.source, 'rule');
});

test('acceptance F: star fruit juice stays avoid without any lookup', async () => {
  process.env.USDA_API_KEY = 'k';
  globalThis.fetch = failIfCalled();
  const ai = { models: { generateContent: async () => assert.fail('ai must not be used') } };
  const result = await checkFood({ food: { name: 'star fruit juice' }, profile }, { ai });
  assert.equal(result.verdict, 'avoid');
  assert.equal(result.source, 'rule');
});
