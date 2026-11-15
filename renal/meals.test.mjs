import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { checkFood } from './check.mjs';
import { suggestMeals } from './meals.mjs';

const ENV_KEYS = ['GOOGLE_API_KEY', 'RENAL_MEALS_MODEL', 'RENAL_MEALS_FALLBACK_MEALS_MODEL', 'RENAL_MEALS_FALLBACK_MODEL', 'RENAL_STATE_DIR'];
const saved = {};
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = () => { throw new Error('network is not allowed in meals tests'); };
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.RENAL_STATE_DIR = mkdtempSync(join(tmpdir(), 'meals-test-'));
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

function fakeClient(meals, seen = []) {
  return {
    models: {
      generateContent: async (params) => {
        seen.push(params);
        return { text: JSON.stringify({ meals }) };
      },
    },
  };
}

const meal = (over = {}) => ({
  title: 'Herbed chicken with rice and cabbage',
  uses: ['unsalted chicken', 'white rice', 'cabbage', 'olive oil', 'water'],
  missing: [{ name: 'unsalted chicken', quantity: '1 breast' }],
  minutes: 25,
  steps: ['Cook the rice.', 'Pan-cook the chicken.', 'Steam the cabbage.'],
  why: 'Low in sodium.',
  ...over,
});

const scratch = (meals, extra = {}, opts = {}) => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  return suggestMeals({ foods: [], profile: P, count: 1, fromScratch: true, ...extra }, { ai: fakeClient(meals), ...opts });
};

const okCheck = (nutrients, verdict = 'ok') => async () => ({ ok: true, verdict, nutrients, portion: '1 portion' });

test('T1 every ingredient goes to missing with exact totals', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const r = await suggestMeals(
    { foods: ['white rice'], profile: P, count: 1, fromScratch: true },
    { ai: fakeClient([meal()]) },
  );
  assert.equal(r.ok, true);
  assert.equal(r.meals.length, 1);
  const m = r.meals[0];
  assert.deepEqual(new Set(m.missing.map((x) => x.name.toLowerCase())), new Set(['unsalted chicken', 'white rice', 'cabbage']));
  assert.equal(m.missing.find((x) => x.name === 'unsalted chicken').quantity, '1 breast');
  for (const x of m.missing) assert.ok(typeof x.quantity === 'string' && x.quantity.length > 0);
  assert.deepEqual([...m.uses].sort(), ['olive oil', 'water']);
  const sum = { sodiumMg: 0, potassiumMg: 0, phosphorusMg: 0 };
  for (const name of ['unsalted chicken', 'white rice', 'cabbage']) {
    const c = await checkFood({ food: { name }, profile: P });
    for (const k of Object.keys(sum)) sum[k] += c.nutrients[k];
  }
  assert.deepEqual(m.totals, sum);
});

test('T2 avoid drops the meal', async () => {
  for (const bad of ['potato', 'ham']) {
    const r = await scratch([meal({ title: 'Rejected dish', uses: ['white rice', bad], missing: [] })]);
    assert.equal(r.ok, true);
    assert.ok(!r.meals.some((m) => m.title === 'Rejected dish'));
  }
});

test('T3 unknown or off-list drops the meal', async () => {
  const r = await scratch([meal({ title: 'Rejected dish', uses: ['white rice', 'dragon fruit'], missing: [] })]);
  assert.ok(!r.meals.some((m) => m.title === 'Rejected dish'));
  const r2 = await scratch(
    [meal({ title: 'Rejected dish', uses: ['white rice', 'cabbage'], missing: [] })],
    {},
    { check: async ({ food }) => (food.name === 'cabbage'
      ? { ok: true, verdict: 'unknown', nutrients: null }
      : { ok: true, verdict: 'ok', nutrients: { sodiumMg: 1, potassiumMg: 1, phosphorusMg: 1 } }) },
  );
  assert.ok(!r2.meals.some((m) => m.title === 'Rejected dish'));
  assert.ok(!r2.meals.some((m) => m.missing.some((x) => x.name === 'cabbage')));
});

test('T4 null numbers drop the meal', async () => {
  const r = await scratch(
    [meal({ uses: ['white rice'], missing: [] })],
    {},
    { check: okCheck({ sodiumMg: 5, potassiumMg: 5, phosphorusMg: null }) },
  );
  assert.deepEqual(r.meals, []);
  const r2 = await scratch([meal({ uses: ['white rice'], missing: [] })], {}, { check: okCheck(null, 'limit') });
  assert.deepEqual(r2.meals, []);
});

test('T5 the per-meal share', async () => {
  const wide = { limits: { sodiumMg: 3000, potassiumMg: 3000, phosphorusMg: 3000, fluidMl: 1000 }, avoid: [] };
  const two = [meal({ uses: ['white rice', 'cabbage'], missing: [] })];
  const run = (n, key = 'sodiumMg') => {
    process.env.GOOGLE_API_KEY = 'dummy-key';
    const nutrients = { sodiumMg: 1, potassiumMg: 1, phosphorusMg: 1, [key]: n };
    return suggestMeals({ foods: [], profile: wide, count: 1, fromScratch: true }, { ai: fakeClient(two), check: okCheck(nutrients) });
  };
  const exact = await run(500);
  assert.equal(exact.meals.length, 1);
  assert.equal(exact.meals[0].totals.sodiumMg, 1000);
  assert.deepEqual((await run(501)).meals, []);
  assert.deepEqual((await run(501, 'potassiumMg')).meals, []);
  assert.deepEqual((await run(501, 'phosphorusMg')).meals, []);
});

test('T6 too many ingredients', async () => {
  const names = ['apple', 'grapes', 'cabbage', 'white rice', 'cucumber', 'lettuce', 'onion'];
  const small = okCheck({ sodiumMg: 1, potassiumMg: 1, phosphorusMg: 1 });
  const seven = await scratch([meal({ title: 'Rejected dish', uses: names, missing: [] })], {}, { check: small });
  assert.ok(!seven.meals.some((m) => m.title === 'Rejected dish'));
  const six = await scratch([meal({ uses: names.slice(0, 6), missing: [] })], {}, { check: small });
  assert.equal(six.meals.length, 1);
});

test('T6b built-in meals are offered when no proposed dish passes, through the same checks', async () => {
  const r = await scratch([meal({ title: 'Rejected dish', uses: ['white rice', 'dragon fruit'], missing: [] })]);
  assert.equal(r.ok, true);
  assert.ok(r.meals.length >= 1);
  for (const m of r.meals) {
    assert.notEqual(m.title, 'Rejected dish');
    for (const key of ['sodiumMg', 'potassiumMg', 'phosphorusMg']) assert.ok(m.totals[key] <= P.limits[key] / 3);
  }
  // Nothing is offered when the built-in meals fail the checks too.
  const none = await scratch(
    [meal({ title: 'Rejected dish', uses: ['dragon fruit'], missing: [] })],
    {},
    { check: async () => ({ ok: true, verdict: 'unknown', nutrients: null }) },
  );
  assert.deepEqual(none.meals, []);
  assert.ok(typeof none.message === 'string' && none.message.length > 0);
});

test('T7 fallback works from scratch', async () => {
  const r = await suggestMeals({ foods: [], profile: P, count: 2, fromScratch: true });
  assert.equal(r.ok, true);
  assert.ok(r.meals.length >= 1 && r.meals.length <= 2);
  for (const m of r.meals) {
    assert.deepEqual(m.uses, []);
    assert.ok(m.missing.length >= 1);
    for (const key of ['sodiumMg', 'potassiumMg', 'phosphorusMg']) {
      assert.ok(Number.isFinite(m.totals[key]));
      assert.ok(m.totals[key] <= P.limits[key] / 3);
    }
  }
  const names = r.meals.flatMap((m) => m.missing.map((x) => x.name));
  assert.ok(names.includes('unsalted chicken') || names.includes('white rice'));
});

test('T8 the from-scratch prompt', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const seen = [];
  await suggestMeals({ foods: [], profile: P, count: 1, fromScratch: true }, { ai: fakeClient([meal()], seen) });
  const text = String(seen[0].contents);
  assert.doesNotMatch(text, /actually seen/i);
  assert.match(text, /built-in renal food list/i);
  assert.match(text, /salt substitutes/i);
  assert.ok(text.includes('white rice: '));
  assert.ok(!text.includes('ham: '));
  assert.ok(!text.includes('deli turkey: '));
  for (const n of ['766', '666', '333']) assert.ok(text.includes(n), n);
});

test('T9 kitchen mode is unchanged', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const kitchen = meal({ uses: ['white rice', 'cabbage'], missing: [] });
  const r = await suggestMeals({ foods: ['white rice', 'cabbage'], profile: P, count: 1 }, { ai: fakeClient([kitchen]) });
  assert.equal(r.ok, true);
  assert.equal(r.meals.length, 1);
  assert.equal('totals' in r.meals[0], false);
});

test('T10 validation', async () => {
  const a = await suggestMeals({ foods: [], profile: P, count: 1, fromScratch: 'yes' });
  assert.equal(a.ok, false);
  const b = await suggestMeals({ foods: [], profile: { limits: {}, avoid: [] }, count: 1, fromScratch: true });
  assert.equal(b.ok, false);
});
