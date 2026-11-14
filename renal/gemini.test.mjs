import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { generateJsonWithFallback } from './gemini.mjs';
import { describeImage } from './vision.mjs';
import { suggestMeals } from './meals.mjs';

const ENV_KEYS = [
  'GOOGLE_API_KEY',
  'RENAL_VISION_MODEL',
  'RENAL_VISION_FALLBACK_MODEL',
  'RENAL_MEALS_MODEL',
  'RENAL_MEALS_FALLBACK_MODEL',
];
const saved = {};
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// behaviours: model -> async (params) => text
function fakeClient(behaviours) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (params) => {
        calls.push(params.model);
        const signal = params.config?.abortSignal;
        const behave = behaviours[params.model];
        if (!behave) throw new Error(`unexpected model ${params.model}`);
        return behave(params, signal);
      },
    },
  };
}

const waitAbortable = (signal) => new Promise((_, reject) => {
  signal?.addEventListener('abort', () => reject(new Error('aborted')));
});

const run = (ai, extra = {}) => generateJsonWithFallback({
  ai,
  models: ['primary', 'fallback'],
  buildRequest: (model, signal) => ({ model, contents: 'x', config: { abortSignal: signal } }),
  parse: (text) => {
    const value = JSON.parse(text);
    return value?.ok ? value : null;
  },
  totalMs: 400,
  hedgeMs: 100,
  label: 'test call',
  ...extra,
});

const good = (tag) => async () => ({ text: JSON.stringify({ ok: true, tag }) });

test('a quick primary answer never starts the fallback', async () => {
  const ai = fakeClient({ primary: good('p'), fallback: good('f') });
  const result = await run(ai);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'primary');
  await sleep(150);
  assert.deepEqual(ai.calls, ['primary']);
});

test('a failing primary starts the fallback immediately', async () => {
  const ai = fakeClient({
    primary: async () => { throw new Error('503 high demand'); },
    fallback: good('f'),
  });
  const started = Date.now();
  const result = await run(ai);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'fallback');
  assert.ok(Date.now() - started < 90);
});

test('a silent primary is hedged by the fallback at hedgeMs', async () => {
  const ai = fakeClient({ primary: (_, signal) => waitAbortable(signal), fallback: good('f') });
  const started = Date.now();
  const result = await run(ai);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'fallback');
  assert.ok(Date.now() - started < 380);
});

test('unparseable primary output counts as a failure', async () => {
  const ai = fakeClient({
    primary: async () => ({ text: 'not json' }),
    fallback: good('f'),
  });
  const result = await run(ai);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'fallback');
});

test('both failing returns a short error and never throws', async () => {
  const ai = fakeClient({
    primary: async () => { throw new Error('a'.repeat(300)); },
    fallback: async () => { throw new Error('b'.repeat(300)); },
  });
  const result = await run(ai);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length <= 120);
});

test('no answer by the deadline times out and aborts the losers', async () => {
  let aborted = 0;
  const hang = (_, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { aborted += 1; reject(new Error('aborted')); });
  });
  const ai = fakeClient({ primary: hang, fallback: hang });
  const started = Date.now();
  const result = await run(ai);
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.ok(Date.now() - started < 600);
  assert.equal(aborted, 2);
});

test('the same primary and fallback id makes one request', async () => {
  const ai = fakeClient({ primary: async () => { throw new Error('boom'); } });
  const result = await run(ai, { models: ['primary', 'primary'] });
  assert.equal(result.ok, false);
  assert.deepEqual(ai.calls, ['primary']);
});

const labelJson = JSON.stringify({
  kind: 'label',
  foods: [],
  label: {
    product: 'Coca-Cola',
    servingSize: null,
    sodiumMg: null,
    potassiumMg: null,
    phosphorusMg: null,
    ingredients: null,
  },
});

test('describeImage falls back to the second model', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const ai = fakeClient({
    'gemini-3.8-flash': async () => { throw new Error('503 high demand'); },
    'gemini-3.5-flash-lite': async () => ({ text: labelJson }),
  });
  const result = await describeImage({ jpeg: Buffer.alloc(4, 1) }, { ai });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'label');
  assert.deepEqual(ai.calls, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
});

test('suggestMeals uses the fallback model instead of the canned meals', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const meal = {
    title: 'Rice and cabbage bowl',
    uses: ['white rice', 'cabbage'],
    missing: [],
    minutes: 15,
    steps: ['Cook rice.', 'Steam cabbage.'],
    why: 'Low in potassium and sodium.',
  };
  const ai = fakeClient({
    'gemini-3.8-flash': async () => { throw new Error('503 high demand'); },
    'gemini-3.5-flash-lite': async () => ({ text: JSON.stringify({ meals: [meal] }) }),
  });
  const profile = {
    limits: { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
    avoid: ['star fruit'],
  };
  const result = await suggestMeals({ foods: ['white rice', 'cabbage'], profile, count: 1 }, { ai });
  assert.equal(result.ok, true);
  assert.equal(result.meals[0].title, 'Rice and cabbage bowl');
});

test('meal prompt requests recognizable dishes and supplies preferred built-in foods', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const meal = {
    title: 'Chicken and rice soup',
    uses: ['white rice', 'cabbage'],
    missing: [{ name: 'apple', quantity: '1 medium' }],
    minutes: 25,
    steps: ['Cook the rice.', 'Add cabbage and apple.'],
    why: 'A simple meal.',
  };
  let prompt = '';
  const ai = fakeClient({
    'gemini-3.8-flash': async (params) => {
      prompt = params.contents;
      return { text: JSON.stringify({ meals: [meal] }) };
    },
  });
  const profile = {
    limits: { sodiumMg: 2300, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
    avoid: ['star fruit'],
  };
  const result = await suggestMeals({ foods: ['white rice', 'cabbage'], profile, count: 1 }, { ai });
  assert.equal(result.ok, true);
  assert.equal(result.meals[0].title, meal.title);
  assert.deepEqual(result.meals[0].missing, meal.missing);
  assert.match(prompt, /real, recognizable dishes/i);
  assert.match(prompt, /up to three missing food ingredients/i);
  assert.match(prompt, /white rice/);
  assert.match(prompt, /banana/);
});

test('pantry staples are removed from missing ingredients and food checks', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const meal = {
    title: 'Cabbage and rice bowl',
    uses: ['white rice', 'cabbage', 'water', 'oil', 'black pepper', 'oregano'],
    missing: [
      { name: 'water', quantity: '1 cup' },
      { name: 'olive oil', quantity: '1 teaspoon' },
      { name: 'black pepper', quantity: 'to taste' },
      { name: 'oregano', quantity: 'to taste' },
      { name: 'apple', quantity: '1 medium' },
    ],
    minutes: 15,
    steps: ['Cook rice and cabbage.'],
    why: 'A simple meal.',
  };
  const ai = fakeClient({ 'gemini-3.8-flash': async () => ({ text: JSON.stringify({ meals: [meal] }) }) });
  const profile = {
    limits: { sodiumMg: 2300, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
    avoid: ['star fruit'],
  };
  const result = await suggestMeals({ foods: ['white rice', 'cabbage'], profile, count: 1 }, { ai });
  assert.equal(result.ok, true);
  assert.deepEqual(result.meals[0].missing, [{ name: 'apple', quantity: '1 medium' }]);
  assert.ok(result.meals[0].uses.includes('white rice'));
  assert.ok(result.meals[0].uses.includes('cabbage'));
});

test('rejects a recipe when a missing ingredient is unsafe', async () => {
  process.env.GOOGLE_API_KEY = 'dummy-key';
  const meal = {
    title: 'Rice with star fruit',
    uses: ['white rice'],
    missing: [{ name: 'star fruit', quantity: '1 fruit' }],
    minutes: 10,
    steps: ['Cook rice and serve with star fruit.'],
    why: 'A meal.',
  };
  const ai = fakeClient({ 'gemini-3.8-flash': async () => ({ text: JSON.stringify({ meals: [meal] }) }) });
  const profile = {
    limits: { sodiumMg: 2300, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
    avoid: ['star fruit'],
  };
  const result = await suggestMeals({ foods: ['white rice'], profile, count: 1 }, { ai });
  assert.deepEqual(result.meals, []);
  assert.match(result.message, /show me the cupboards/i);
});

test('asks to see cupboards when no kitchen ingredients were provided', async () => {
  const result = await suggestMeals({
    foods: [],
    profile: {
      limits: { sodiumMg: 2300, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
      avoid: ['star fruit'],
    },
    count: 1,
  });
  assert.deepEqual(result.meals, []);
  assert.match(result.message, /show me the cupboards/i);
});

test('generateJsonWithFallback passes the full response as the second argument to parse', async () => {
  const response = { text: 'hello', candidates: [{ marker: 1 }] };
  const ai = { models: { generateContent: async () => response } };
  let seen;
  const result = await generateJsonWithFallback({
    ai,
    models: ['m'],
    buildRequest: (model) => ({ model }),
    parse: (text, full) => {
      seen = { text, full };
      return text;
    },
    totalMs: 500,
    hedgeMs: 200,
  });
  assert.equal(result.ok, true);
  assert.equal(seen.text, 'hello');
  assert.equal(seen.full, response);
});
