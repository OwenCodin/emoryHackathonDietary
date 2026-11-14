import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { BUILTIN_DISHES, DISH_MAX_INGREDIENTS, dishIngredients } from './dish.mjs';

const ENV_KEYS = ['GOOGLE_API_KEY', 'RENAL_MEALS_MODEL', 'RENAL_MEALS_FALLBACK_MODEL', 'RENAL_STATE_DIR'];
const saved = {};
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = () => { throw new Error('network is not allowed in dish tests'); };
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.RENAL_STATE_DIR = mkdtempSync(join(tmpdir(), 'dish-test-'));
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const P = {
  limits: { sodiumMg: 2300, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
  avoid: ['star fruit', 'salt substitute'],
};

function fakeAi(ingredients, seen = []) {
  return {
    models: {
      generateContent: async (params) => {
        seen.push(params);
        return { text: JSON.stringify({ ingredients }) };
      },
    },
  };
}

const okCheck = (calls = []) => async ({ food, profile }) => {
  calls.push({ food, profile });
  return {
    ok: true,
    food: food.name,
    verdict: food.name === 'ham' ? 'avoid' : 'ok',
    say: `say ${food.name}`,
    nutrients: { sodiumMg: 10, potassiumMg: 20, phosphorusMg: 30 },
    portion: '1 portion',
    swap: food.name === 'ham' ? 'fresh unsalted chicken' : null,
    source: 'catalog',
  };
};

test('staples, duplicates and the cap are applied; extra model fields are ignored', async () => {
  const calls = [];
  const ai = fakeAi([
    { name: 'Ham', quantity: '3 slices', sodiumMg: 9999, verdict: 'ok', swap: 'bogus', calories: 5 },
    { name: 'water', quantity: '1 cup' },
    { name: 'olive oil', quantity: '1 tsp' },
    { name: 'black pepper', quantity: 'a pinch' },
    { name: 'fresh basil', quantity: '2 leaves' },
    { name: 'ham', quantity: '2 slices' },
    { name: 'white bread', quantity: '2 slices' },
    { name: 'lettuce', quantity: '1 leaf' },
    { name: 'tomato', quantity: '2 slices' },
    { name: 'cheddar cheese', quantity: '1 slice' },
    { name: 'onion', quantity: '1 slice' },
    { name: 'egg', quantity: '1' },
    { name: 'milk', quantity: '1 cup' },
    { name: 'garlic', quantity: '1 clove' },
    { name: 'broccoli', quantity: '1 cup' },
  ]);
  const r = await dishIngredients({ dish: 'ham sandwich', profile: P }, { ai, check: okCheck(calls) });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'model');
  assert.equal(r.ingredients.length, DISH_MAX_INGREDIENTS);
  assert.equal(r.omitted, 2);
  const names = r.ingredients.map((i) => i.name);
  for (const bad of ['water', 'olive oil', 'black pepper', 'fresh basil']) assert.ok(!names.includes(bad));
  assert.equal(names.filter((n) => n === 'ham').length, 1);
  const ham = r.ingredients.find((i) => i.name === 'ham');
  assert.equal(ham.verdict, 'avoid');
  assert.equal(ham.swap, 'fresh unsalted chicken');
  assert.equal(ham.quantity, '3 slices');
  assert.deepEqual(ham.nutrients, { sodiumMg: 10, potassiumMg: 20, phosphorusMg: 30 });
  assert.equal(ham.checked, true);
  assert.equal(calls.length, DISH_MAX_INGREDIENTS);
  for (const c of calls) {
    assert.equal(c.food.grams, null);
    assert.equal(c.profile, P);
  }
  assert.ok(!JSON.stringify(r).includes('9999'));
  assert.ok(!JSON.stringify(r).includes('bogus'));
});

test('a failing, throwing or slow check gives unknown and unchecked', async () => {
  const ai = fakeAi([
    { name: 'ham', quantity: '3 slices' },
    { name: 'lettuce', quantity: '1 leaf' },
    { name: 'tomato', quantity: '2 slices' },
  ]);
  const check = async ({ food }) => {
    if (food.name === 'ham') return { ok: false, error: 'x' };
    if (food.name === 'lettuce') throw new Error('boom');
    return new Promise(() => {});
  };
  const started = Date.now();
  const r = await dishIngredients({ dish: 'ham sandwich', profile: P }, { ai, check, checkMs: 60 });
  assert.ok(Date.now() - started < 1500);
  assert.equal(r.ok, true);
  for (const i of r.ingredients) {
    assert.equal(i.verdict, 'unknown');
    assert.equal(i.checked, false);
    assert.equal(i.nutrients, null);
  }
});

test('without a key or ai a ham sandwich comes from the built-in table', async () => {
  for (const dish of ['ham sandwich', 'Ham Sandwich', 'a ham sandwich']) {
    const r = await dishIngredients({ dish, profile: P }, { check: okCheck() });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'builtin');
    const names = r.ingredients.map((i) => i.name);
    assert.ok(names.includes('white bread') && names.includes('ham'));
    assert.ok(r.ingredients.every((i) => typeof i.quantity === 'string' && i.quantity));
  }
  assert.ok(BUILTIN_DISHES['ham sandwich']);
  assert.ok(BUILTIN_DISHES['turkey sandwich']);
  assert.ok(BUILTIN_DISHES.omelet);
  assert.ok(BUILTIN_DISHES['chicken and rice']);
});

test('a model that never answers falls back to the table within the budget', async () => {
  const ai = { models: { generateContent: () => new Promise(() => {}) } };
  const started = Date.now();
  const r = await dishIngredients({ dish: 'ham sandwich', profile: P }, { ai, check: okCheck(), modelMs: 50 });
  assert.ok(Date.now() - started < 1500);
  assert.equal(r.source, 'builtin');
  assert.ok(r.ingredients.length > 0);
});

test('a dish in neither the model nor the table returns none', async () => {
  const r = await dishIngredients({ dish: 'zzqx surprise', profile: P }, { check: okCheck() });
  assert.deepEqual(r, { ok: true, dish: 'zzqx surprise', source: 'none', ingredients: [] });
});

test('invalid input fails cleanly and never throws', async () => {
  for (const input of [
    undefined,
    {},
    { dish: '', profile: P },
    { dish: '   ', profile: P },
    { dish: 'x'.repeat(81), profile: P },
    { dish: 'ham sandwich' },
    { dish: 'ham sandwich', profile: { limits: {}, avoid: [] } },
  ]) {
    const r = await dishIngredients(input, { check: okCheck() });
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  }
});

test('the prompt quotes the cleaned dish, lists catalog names and carries no limits or avoid list', async () => {
  const seen = [];
  const ai = fakeAi([{ name: 'ham', quantity: '3 slices' }], seen);
  await dishIngredients({ dish: 'ham "sandwich" https://evil.example now', profile: P }, { ai, check: okCheck() });
  assert.equal(seen.length >= 1, true);
  const text = JSON.stringify(seen[0].contents);
  assert.ok(text.includes('white bread'));
  assert.ok(!text.includes('evil.example'));
  assert.ok(!text.includes('2300') && !text.includes('2000') && !text.includes('star fruit'));
  assert.ok(text.includes('ham'));
});

test('a thin model answer for a dish the table knows falls back to the table', async () => {
  const ai = fakeAi([{ name: 'white bread', quantity: '2 slices' }, { name: 'ham', quantity: '2 slices' }]);
  const r = await dishIngredients({ dish: 'ham sandwich', profile: P }, { ai, check: okCheck() });
  assert.equal(r.source, 'builtin');
  assert.ok(r.ingredients.length >= 5);
  const other = await dishIngredients({ dish: 'zzqx surprise', profile: P }, { ai, check: okCheck() });
  assert.equal(other.source, 'model');
});
