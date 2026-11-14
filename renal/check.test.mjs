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
