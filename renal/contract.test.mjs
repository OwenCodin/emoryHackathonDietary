import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  checkFood,
  describeImage,
  getProfile,
  getToday,
  logFood,
  suggestMeals,
} from './index.mjs';

// Keep diary and USDA cache writes out of the committed renal/data files.
const stateDir = await mkdtemp(join(tmpdir(), 'renal-state-'));
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

async function withoutKeys(run) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const usdaKey = process.env.USDA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.USDA_API_KEY;
  try {
    return await run();
  } finally {
    if (googleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = googleKey;
    if (usdaKey === undefined) delete process.env.USDA_API_KEY;
    else process.env.USDA_API_KEY = usdaKey;
  }
}

test('loads the seeded care-team profile', async () => {
  const result = await getProfile({});
  assert.equal(result.ok, true);
  assert.equal(result.profile.name, 'Sam');
  assert.equal(result.profile.limits.sodiumMg, 2300);
  assert.equal(result.profile.limits.potassiumMg, profile.limits.potassiumMg);
  assert.match(result.profile.limitsNote, /illustrative demo profile/i);
});

test('judges a label using its per-serving sodium value', async () => {
  const result = await checkFood({
    food: {
      name: 'Chicken broth',
      label: {
        product: 'Chicken broth',
        servingSize: '1 cup (240 mL)',
        sodiumMg: 860,
        potassiumMg: null,
        phosphorusMg: null,
        ingredients: 'chicken stock, salt',
      },
    },
    profile,
  });
  assert.equal(result.verdict, 'avoid');
  assert.equal(result.source, 'label');
  assert.equal(result.nutrients.sodiumMg, 860);
});

test('phosphate additives prevent an unlabeled phosphorus amount from being treated as safe', async () => {
  const result = await checkFood({
    food: {
      name: 'Canned broth',
      label: {
        servingSize: '1 cup',
        sodiumMg: 10,
        potassiumMg: null,
        phosphorusMg: null,
        ingredients: 'water, salt, sodium phosphate',
      },
    },
    profile,
  });
  assert.equal(result.verdict, 'limit');
  assert.equal(result.source, 'rule');
  assert.match(result.reasons.join(' '), /phosphate additive/i);
});

test('seeded banana data produces a potassium limit without network access', async () => {
  const result = await withoutKeys(() => checkFood({ food: { name: 'banana' }, profile }));
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'limit');
  assert.match(result.reasons.join(' '), /potassium/i);
  assert.equal(result.nutrients.potassiumMg, 422);
  assert.equal(result.source, 'usda');
});

test('unknown foods are unknown and contain no invented nutrient values', async () => {
  const result = await withoutKeys(() => checkFood({ food: { name: 'unlisted mystery snack' }, profile }));
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.nutrients, null);
  assert.equal(result.source, 'none');
  assert.doesNotMatch(result.say, /\d/);
});

test('sanity-checks the requested renal food list', async () => {
  const expected = new Map([
    ['banana', ['limit', 'avoid']],
    ['potato', ['limit', 'avoid']],
    ['tomato', ['limit', 'avoid']],
    ['orange', ['limit', 'avoid']],
    ['avocado', ['limit', 'avoid']],
    ['kidney beans', ['limit', 'avoid']],
    ['cola', ['limit', 'avoid']],
    ['processed cheese', ['limit', 'avoid']],
    ['deli turkey', ['limit', 'avoid']],
    ['apple', ['ok']],
    ['grapes', ['ok']],
    ['cabbage', ['ok']],
    ['white rice', ['ok']],
    ['unsalted chicken', ['ok']],
  ]);
  for (const [name, allowed] of expected) {
    const result = await checkFood({ food: { name }, profile });
    assert.ok(allowed.includes(result.verdict), `${name}: got ${result.verdict}`);
  }
});

test('hard avoid rules apply even when there is no nutrient lookup result', async () => {
  const result = await checkFood({ food: { name: 'star fruit' }, profile });
  assert.equal(result.verdict, 'avoid');
  assert.equal(result.source, 'rule');
});

test('drink portions mention the fluid limit', async () => {
  const result = await checkFood({ food: { name: 'water' }, profile });
  assert.equal(result.verdict, 'ok');
  assert.match(result.reasons.join(' '), /fluid limit/i);
});

test('suggests and verifies seeded meals offline', async () => {
  const result = await withoutKeys(() =>
    suggestMeals({ foods: ['chicken', 'white rice', 'cabbage'], profile, count: 2 }));
  assert.equal(result.ok, true);
  assert.ok(result.meals.length > 0);
  assert.ok(result.meals.length <= 2);
  assert.ok(result.meals.every((meal) =>
    Array.isArray(meal.uses) && Array.isArray(meal.missing) && meal.missing.every((item) => item.quantity)));
});

test('persists diary entries and computes today totals', async () => {
  {
    const logged = await logFood({
      patientId: 'demo',
      verdict: {
        ok: true,
        food: 'apple',
        verdict: 'ok',
        portion: '1 apple',
        nutrients: { sodiumMg: 2, potassiumMg: 194, phosphorusMg: 20 },
      },
    });
    assert.equal(logged.ok, true);
    const today = await getToday({ patientId: 'demo' });
    assert.equal(today.ok, true);
    assert.equal(today.totals.sodiumMg, 2);
    assert.equal(today.totals.potassiumMg, 194);
    assert.equal(today.remaining.potassiumMg, profile.limits.potassiumMg - 194);
  }
});

test('returns failure objects for invalid inputs and unavailable services', async () => {
  assert.equal((await getProfile({ patientId: 'missing' })).ok, false);
  assert.equal((await getProfile(null)).ok, false);
  assert.equal((await checkFood(null)).ok, false);
  assert.equal((await checkFood({ food: {}, profile })).ok, false);
  assert.equal((await suggestMeals(null)).ok, false);
  assert.equal((await suggestMeals({ foods: 'apple', profile })).ok, false);
  assert.equal((await logFood(null)).ok, false);
  assert.equal((await logFood({ verdict: {} })).ok, false);
  assert.equal((await getToday(null)).ok, false);
  assert.equal((await getToday({ patientId: 'missing' })).ok, false);
  const image = await withoutKeys(() => describeImage({ jpeg: Buffer.from('not an image') }));
  assert.equal(image.ok, false);
  assert.equal((await describeImage(null)).ok, false);
});

test('a USDA outage with no web result is an honest unknown, not a failure', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.USDA_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  process.env.USDA_API_KEY = 'test-key';
  delete process.env.GOOGLE_API_KEY;
  globalThis.fetch = async () => {
    throw new Error('network unavailable');
  };
  try {
    const result = await checkFood({ food: { name: 'network-only food' }, profile });
    assert.equal(result.ok, true);
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.source, 'none');
    assert.match(result.say, /I do not have reliable nutrition numbers for network-only food, so I cannot judge it yet\./);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.USDA_API_KEY;
    else process.env.USDA_API_KEY = previousKey;
    if (previousGoogle !== undefined) process.env.GOOGLE_API_KEY = previousGoogle;
  }
});
