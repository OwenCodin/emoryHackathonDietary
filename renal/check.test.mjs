import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach, beforeEach } from 'node:test';
import { checkFood, numberWords } from './check.mjs';

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
